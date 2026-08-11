#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Bitte mit sudo ausfuehren." >&2; exit 1; }

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$source_dir/../docker" && pwd)"
pin_file="$project_dir/secrets/maintenance_pin"

command -v python3 >/dev/null 2>&1 || {
  apt-get update
  apt-get install --yes python3
}

install -d -m 755 /usr/local/lib/clubiq-maintenance
install -m 755 "$source_dir/server.py" /usr/local/lib/clubiq-maintenance/server.py
install -m 644 "$source_dir/clubiq-maintenance.service" /etc/systemd/system/clubiq-maintenance.service
install -d -m 700 "$project_dir/secrets"

if [[ ! -s "$pin_file" ]]; then
  pin="$(python3 -c 'import secrets; print(f"{secrets.randbelow(1000000):06d}")')"
  printf '%s' "$pin" > "$pin_file"
fi
chmod 600 "$pin_file"

cat > /etc/clubiq-maintenance.env <<EOF
CLUBIQ_PROJECT_DIR=$project_dir
CLUBIQ_MAINTENANCE_PIN_FILE=$pin_file
CLUBIQ_MAINTENANCE_HOST=0.0.0.0
CLUBIQ_MAINTENANCE_PORT=8091
EOF
chmod 600 /etc/clubiq-maintenance.env

systemctl daemon-reload
systemctl enable --now clubiq-maintenance.service
systemctl restart clubiq-maintenance.service

echo "Wartungsportal: http://10.42.0.1:8091"
echo "Wartungs-PIN: $(cat "$pin_file")"
echo "Die PIN bitte getrennt und sicher notieren."
