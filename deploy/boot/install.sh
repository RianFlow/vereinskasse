#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || {
  echo "Bitte mit sudo ausführen." >&2
  exit 1
}

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$source_dir/../docker" && pwd)"

install -d -m 0755 /usr/local/lib/clubiq-ledger-boot
install -m 0755 "$source_dir/boot-ensure.sh" /usr/local/lib/clubiq-ledger-boot/boot-ensure.sh
install -m 0644 "$source_dir/clubiq-ledger-boot.service" /etc/systemd/system/clubiq-ledger-boot.service
printf 'CLUBIQ_PROJECT_DIR=%s\n' "$project_dir" > /etc/clubiq-ledger-boot.env
chmod 0600 /etc/clubiq-ledger-boot.env

systemctl daemon-reload
systemctl enable clubiq-ledger-boot.service
echo "Zuverlässiger ClubIQ-Systemstart ist eingerichtet."
