#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Bitte mit sudo ausfuehren." >&2; exit 1; }
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker_dir="$(cd "$source_dir/../docker" && pwd)"
install -d -m 755 /usr/local/lib/clubiq-monthly-mail
install -m 755 "$source_dir/run.sh" /usr/local/lib/clubiq-monthly-mail/run.sh
install -m 644 "$source_dir/clubiq-monthly-mail.service" /etc/systemd/system/clubiq-monthly-mail.service
install -m 644 "$source_dir/clubiq-monthly-mail.timer" /etc/systemd/system/clubiq-monthly-mail.timer
if [[ ! -s "$docker_dir/secrets/monthly_mail_token" ]]; then
  umask 077
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$docker_dir/secrets/monthly_mail_token"
fi
chmod 600 "$docker_dir/secrets/monthly_mail_token"
docker compose --project-directory "$docker_dir" --env-file "$docker_dir/.env" -f "$docker_dir/compose.yaml" up -d --no-deps --force-recreate app
systemctl daemon-reload
systemctl enable --now clubiq-monthly-mail.timer
echo "Automatischer Monatsversand ist aktiv: jeweils am 1. ab 08:00 Uhr."
systemctl list-timers clubiq-monthly-mail.timer --no-pager
