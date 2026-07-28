#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(id -u)" -eq 0 ]] || {
  echo "Bitte mit sudo ausführen." >&2
  exit 1
}
[[ "$(dpkg --print-architecture)" == "arm64" ]] || {
  echo "Benötigt Raspberry Pi OS 64-Bit (arm64)." >&2
  exit 1
}

NODE_VERSION="${NODE_VERSION:-22.17.1}"
GIT_BRANCH="${VEREINSKASSE_GIT_BRANCH:-main}"
GIT_URL="${VEREINSKASSE_GIT_URL:-https://github.com/RianFlow/vereinskasse.git}"

apt-get update
apt-get install -y ca-certificates curl git nginx openssl sqlite3 avahi-daemon xz-utils

installed_major="$(node --version 2>/dev/null | sed -n 's/^v\\([0-9]*\\).*/\\1/p' || true)"
if [[ -z "$installed_major" || "$installed_major" -lt 22 ]]; then
  archive="node-v${NODE_VERSION}-linux-arm64.tar.xz"
  download="$(mktemp -d)"
  trap 'rm -rf -- "$download"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 \
    "https://nodejs.org/dist/v${NODE_VERSION}/$archive" -o "$download/$archive"
  curl --fail --location --proto '=https' --tlsv1.2 \
    "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "$download/SHASUMS256.txt"
  (cd "$download" && grep "  $archive\$" SHASUMS256.txt | sha256sum -c -)
  mkdir -p /opt/node
  tar -xJf "$download/$archive" -C /opt/node --strip-components=1
  ln -sfn /opt/node/bin/node /usr/local/bin/node
  ln -sfn /opt/node/bin/npm /usr/local/bin/npm
  ln -sfn /opt/node/bin/npx /usr/local/bin/npx
fi

id vereinskasse >/dev/null 2>&1 ||
  useradd --system --home /var/lib/vereinskasse --shell /usr/sbin/nologin vereinskasse
install -d -o vereinskasse -g vereinskasse -m 750 /var/lib/vereinskasse/data
install -d -o root -g root -m 755 /opt/vereinskasse/releases
install -d -o root -g root -m 700 /var/backups/vereinskasse
install -d -o root -g root -m 750 /etc/vereinskasse /etc/vereinskasse/tls

cat > /etc/vereinskasse/environment <<EOF
VEREINSKASSE_RUNTIME=raspberry
VEREINSKASSE_APP_DIR=/opt/vereinskasse/current
VEREINSKASSE_DATA_DIR=/var/lib/vereinskasse/data
VEREINSKASSE_DATABASE_PATH=/var/lib/vereinskasse/data/vereinskasse.sqlite
VEREINSKASSE_BACKUP_DIR=/var/lib/vereinskasse/data/backups
VEREINSKASSE_OS_BACKUP_DIR=/var/backups/vereinskasse
VEREINSKASSE_SECONDARY_BACKUP_DIR=
VEREINSKASSE_GIT_URL=$GIT_URL
VEREINSKASSE_GIT_BRANCH=$GIT_BRANCH
HOST=127.0.0.1
PORT=3000
NODE_ENV=production
EOF
chmod 600 /etc/vereinskasse/environment

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -m 755 "$source_dir/backup.sh" /usr/local/sbin/vereinskasse-backup
install -m 755 "$source_dir/restore.sh" /usr/local/sbin/vereinskasse-restore
install -m 755 "$source_dir/update.sh" /usr/local/sbin/vereinskasse-update
install -m 644 "$source_dir/vereinskasse.service" /etc/systemd/system/
install -m 644 "$source_dir/vereinskasse-backup.service" /etc/systemd/system/
install -m 644 "$source_dir/vereinskasse-backup.timer" /etc/systemd/system/

local_ip="$(hostname -I | awk '{print $1}')"
tls_dir=/etc/vereinskasse/tls
if [[ ! -f "$tls_dir/ca.key" ]]; then
  openssl genrsa -out "$tls_dir/ca.key" 4096
  openssl req -x509 -new -nodes -key "$tls_dir/ca.key" -sha256 -days 3650 \
    -subj "/CN=SV Barver Vereinskasse" -out "$tls_dir/ca.crt"
fi
openssl genrsa -out "$tls_dir/server.key" 2048
openssl req -new -key "$tls_dir/server.key" \
  -subj "/CN=vereinskasse.local" -out "$tls_dir/server.csr"
cat > "$tls_dir/server.ext" <<EOF
subjectAltName=DNS:vereinskasse.local,IP:$local_ip
extendedKeyUsage=serverAuth
keyUsage=digitalSignature,keyEncipherment
EOF
openssl x509 -req -in "$tls_dir/server.csr" -CA "$tls_dir/ca.crt" \
  -CAkey "$tls_dir/ca.key" -CAcreateserial -out "$tls_dir/server.crt" \
  -days 825 -sha256 -extfile "$tls_dir/server.ext"
chmod 600 "$tls_dir/"*.key

install -d -m 755 /var/www/vereinskasse-ca
install -m 644 "$tls_dir/ca.crt" /var/www/vereinskasse-ca/vereinskasse-ca.crt
install -m 644 "$source_dir/nginx.conf" /etc/nginx/sites-available/vereinskasse
ln -sfn /etc/nginx/sites-available/vereinskasse /etc/nginx/sites-enabled/vereinskasse
rm -f /etc/nginx/sites-enabled/default
nginx -t

systemctl daemon-reload
systemctl enable nginx avahi-daemon vereinskasse vereinskasse-backup.timer
/usr/local/sbin/vereinskasse-update
systemctl restart nginx avahi-daemon
systemctl start vereinskasse-backup.timer

echo
echo "Vereinskasse läuft: https://vereinskasse.local"
echo "Zertifikat fürs Tablet: http://$local_ip:8080/vereinskasse-ca.crt"
echo "Bitte die IP $local_ip im Router fest reservieren."
