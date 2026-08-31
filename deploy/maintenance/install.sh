#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Bitte mit sudo ausfuehren." >&2; exit 1; }

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$source_dir/../docker" && pwd)"
pin_file="$project_dir/secrets/maintenance_pin"

packages=()
command -v python3 >/dev/null 2>&1 || packages+=(python3)
command -v nmcli >/dev/null 2>&1 || packages+=(network-manager)
dpkg-query -W -f='${Status}' firmware-mediatek 2>/dev/null | grep -q 'install ok installed' || packages+=(firmware-mediatek)

if (( ${#packages[@]} > 0 )); then
  apt-get update
  apt-get install --yes "${packages[@]}"
fi

# Der FRITZ!WLAN AC 860 (057c:8503) verwendet den Kernel-Treiber mt76x2u.
# Ein bereits eingesteckter Stick wird so nach der Firmware-Installation erkannt.
modprobe mt76x2u 2>/dev/null || true

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

echo "Wartungsportal: https://10.42.0.1/wartung/"
echo "Notfallzugang ohne E-Mail-Konfiguration: http://10.42.0.1:8091"
echo "Wartungs-PIN: $(cat "$pin_file")"
echo "Die PIN bitte getrennt und sicher notieren."
echo "Internet-WLAN: Im Wartungsportal den USB-Stick suchen, WLAN auswaehlen und Kennwort speichern."
