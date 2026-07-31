#!/usr/bin/env bash
set -Eeuo pipefail

read_secret() {
  local target="$1"
  local file_variable="${target}_FILE"
  local file="${!file_variable:-}"
  if [[ -n "$file" && -r "$file" ]]; then
    printf -v "$target" '%s' "$(<"$file")"
    export "$target"
  fi
}

read_secret PGPASSWORD

interval="${VEREINSKASSE_BACKUP_INTERVAL_SECONDS:-3600}"
[[ "$interval" =~ ^[0-9]+$ && "$interval" -ge 300 ]] || {
  echo "Sicherungsintervall muss mindestens 300 Sekunden betragen." >&2
  exit 1
}

while true; do
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if /app/deploy/raspberry/backup.sh; then
    printf '{"ok":true,"startedAt":"%s","finishedAt":"%s"}\n' \
      "$started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /backups/local/.last-backup.json
    if [[ "${CLUBIQ_R2_ENABLED:-false}" == "true" ]]; then
      /app/deploy/docker/r2-backup.sh || \
        echo "Lokale Sicherung ist gültig; die zusätzliche R2-Kopie ist fehlgeschlagen." >&2
    fi
  else
    printf '{"ok":false,"startedAt":"%s","finishedAt":"%s"}\n' \
      "$started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /backups/local/.last-backup.json
  fi
  sleep "$interval" &
  wait $!
done

