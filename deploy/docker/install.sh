#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || {
  echo "Bitte mit sudo ausführen: sudo ./install.sh" >&2
  exit 1
}

script="$(readlink -f "${BASH_SOURCE[0]}")"
base="$(cd "$(dirname "$script")" && pwd)"
root="$(cd "$base/../.." && pwd)"
[[ -f "$root/package.json" && -d "$root/.git" ]] || {
  echo "Das Projekt muss zuerst vollständig von GitHub geklont werden." >&2
  exit 1
}

architecture="$(dpkg --print-architecture)"
[[ "$architecture" == "arm64" || "$architecture" == "amd64" ]] || {
  echo "Benötigt wird Raspberry Pi OS 64-Bit (arm64). Gefunden: $architecture" >&2
  exit 1
}

install_docker() {
  echo "Docker wird aus dem offiziellen Paketarchiv installiert."
  apt-get update
  apt-get install --yes ca-certificates curl git openssl avahi-daemon network-manager
  apt-get remove --yes docker.io docker-compose docker-doc docker-buildx podman-docker containerd runc 2>/dev/null || true
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: ${architecture}
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install --yes docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

if ! command -v docker >/dev/null 2>&1; then
  install_docker
else
  docker compose version >/dev/null || {
    apt-get update
    apt-get install --yes docker-compose-plugin
  }
  apt-get update
  apt-get install --yes git openssl avahi-daemon curl network-manager
fi
systemctl enable --now avahi-daemon

umask 077
mkdir -p "$base/secrets" /mnt/vereinskasse-sicherung
if [[ ! -f "$base/.env" ]]; then
  install -m 600 "$base/.env.example" "$base/.env"
  host_name="$(hostname | tr -cd 'A-Za-z0-9.-')"
  lan_ip="$(hostname -I | tr ' ' '\n' | awk '/^[0-9]+\./ && $0 !~ /^127\./ { print; exit }')"
  sed -i "s/^CLUBIQ_HOSTNAME=.*/CLUBIQ_HOSTNAME=${host_name:-vereinskasse}.local/" "$base/.env"
  sed -i "s/^CLUBIQ_LAN_IP=.*/CLUBIQ_LAN_IP=${lan_ip:-127.0.0.1}/" "$base/.env"
fi

create_random_secret() {
  local file="$1"
  [[ -f "$file" ]] || openssl rand -base64 48 | tr -d '\n' > "$file"
  chmod 600 "$file"
}
create_random_secret "$base/secrets/postgres_admin_password"
create_random_secret "$base/secrets/postgres_app_password"
create_random_secret "$base/secrets/restic_password"
[[ -f "$base/secrets/r2_access_key_id" ]] || : > "$base/secrets/r2_access_key_id"
[[ -f "$base/secrets/r2_secret_access_key" ]] || : > "$base/secrets/r2_secret_access_key"
[[ -f "$base/secrets/smtp_password" ]] || : > "$base/secrets/smtp_password"
if [[ ! -s "$base/secrets/monthly_mail_token" ]]; then
  umask 077
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$base/secrets/monthly_mail_token"
fi
chmod 600 "$base/secrets/"*

if [[ ! -s "$base/secrets/initial_profile_pin" ]]; then
  initial_pin="${CLUBIQ_INITIAL_PIN:-}"
  while [[ ! "$initial_pin" =~ ^[0-9]{6}$ ]]; do
    read -r -s -p "Erste sechsstellige Profil-PIN: " initial_pin
    echo
    read -r -s -p "PIN wiederholen: " initial_pin_repeat
    echo
    [[ "$initial_pin" == "$initial_pin_repeat" ]] || initial_pin=""
    [[ -n "$initial_pin" ]] || echo "Die PIN muss aus sechs Ziffern bestehen und zweimal gleich sein."
  done
  printf '%s' "$initial_pin" > "$base/secrets/initial_profile_pin"
  chmod 600 "$base/secrets/initial_profile_pin"
  unset initial_pin initial_pin_repeat CLUBIQ_INITIAL_PIN
fi

ln -sfn "$base/clubiq" /usr/local/sbin/clubiq
"$root/deploy/maintenance/install.sh"

cd "$base"
hostname_setting="$(sed -n 's/^CLUBIQ_HOSTNAME=//p' "$base/.env" | tail -n 1)"
hostname_setting="${hostname_setting:-vereinskasse.local}"
if ! docker compose --env-file .env -f compose.yaml pull; then
  echo "Das fertige GitHub-Image ist noch nicht abrufbar; es wird einmalig lokal gebaut."
  docker compose --env-file .env -f compose.yaml build app
fi
docker compose --env-file .env -f compose.yaml up -d --remove-orphans

for attempt in $(seq 1 90); do
  if curl --insecure --fail --silent --max-time 3 \
    --resolve "${hostname_setting}:443:127.0.0.1" \
    "https://${hostname_setting}/api/profiles" >/dev/null; then
    : > "$base/secrets/initial_profile_pin"
    ip="$(hostname -I | awk '{print $1}')"
    echo
    echo "Clubiq Ledger ist eingerichtet."
    echo "Kasse: https://${hostname_setting}"
    echo "Kasse ohne .local: https://${ip:-127.0.0.1}"
    echo "Tablet-Zertifikat: http://${ip:-RASPBERRY-IP}:8080/vereinskasse-ca.crt"
    echo "Status: sudo clubiq status"
    echo "USB später freigeben: sudo clubiq usb-freigeben /mnt/vereinskasse-sicherung"
    "$root/deploy/monthly-mail/install.sh"
    exit 0
  fi
  sleep 2
done

echo "Die Container laufen, aber die Kasse wurde noch nicht gesund. Diagnose: sudo clubiq protokoll" >&2
exit 1
