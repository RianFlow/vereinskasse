#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo 'Bitte mit sudo ausführen.' >&2; exit 1; }
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$source_dir/../docker" && pwd)"
recipient_file="${1:-/etc/clubiq-recovery.recipient}"
[[ -f "$recipient_file" && ! -L "$recipient_file" ]] || { echo 'Öffentliche Empfängerdatei fehlt. Den privaten Schlüssel NICHT auf den Raspberry kopieren.' >&2; exit 1; }
grep -Eq '^age1[0-9a-z]{58}$' "$recipient_file" || { echo 'Öffentlicher age-Schlüssel erwartet.' >&2; exit 1; }
[[ "$(wc -l < "$recipient_file")" -le 1 ]] || { echo 'Genau einen öffentlichen Schlüssel angeben.' >&2; exit 1; }
packages=()
command -v age >/dev/null || packages+=(age)
command -v rclone >/dev/null || packages+=(rclone)
if (( ${#packages[@]} )); then
  apt-get update
  apt-get install --yes "${packages[@]}"
fi
# Validate the checksum/recipient with the actual encryption implementation.
printf 'ClubIQ Empfängerprüfung' | age -R "$recipient_file" >/dev/null
if [[ "$(readlink -f "$recipient_file")" != /etc/clubiq-recovery.recipient ]]; then
  [[ ! -e /etc/clubiq-recovery.recipient ]] || cmp -s "$recipient_file" /etc/clubiq-recovery.recipient || { echo 'Schlüsselwechsel erfordert eine gesonderte Wiederherstellungsprüfung.' >&2; exit 1; }
  install -m 600 "$recipient_file" /etc/clubiq-recovery.recipient
fi
install -d -m 700 /var/lib/clubiq-recovery
install -d -m 755 /usr/local/lib/clubiq-recovery
install -m 755 "$source_dir/recovery.py" /usr/local/lib/clubiq-recovery/recovery.py
install -m 644 "$source_dir/clubiq-recovery.service" /etc/systemd/system/clubiq-recovery.service
install -m 644 "$source_dir/clubiq-recovery.timer" /etc/systemd/system/clubiq-recovery.timer
umask 077
printf 'CLUBIQ_RECOVERY_PROJECT=%s\n' "$project_dir" > /etc/clubiq-recovery.env
systemctl daemon-reload
systemctl enable --now clubiq-recovery.timer
echo 'Automatisches Notfallpaket eingerichtet. Privaten Schlüssel getrennt aufbewahren. Erste Sicherung: sudo clubiq notfall-sichern'
