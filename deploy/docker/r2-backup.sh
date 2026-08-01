#!/usr/bin/env bash
set -Eeuo pipefail

read_secret() {
  local target="$1"
  local file_variable="${target}_FILE"
  local file="${!file_variable:-}"
  [[ -n "$file" && -r "$file" ]] || {
    echo "Geheimnisdatei für $target fehlt." >&2
    exit 1
  }
  printf -v "$target" '%s' "$(<"$file")"
  export "$target"
}

[[ "${CLUBIQ_R2_ENABLED:-false}" == "true" ]] || exit 0
[[ "${CLUBIQ_R2_ENDPOINT:-}" == https://* && -n "${CLUBIQ_R2_BUCKET:-}" ]] || {
  echo "R2-Endpunkt oder Bucket fehlt." >&2
  exit 1
}

read_secret AWS_ACCESS_KEY_ID
read_secret AWS_SECRET_ACCESS_KEY
[[ -r "${RESTIC_PASSWORD_FILE:-}" ]] || {
  echo "Restic-Kennwortdatei fehlt." >&2
  exit 1
}

export AWS_DEFAULT_REGION=auto
export RESTIC_REPOSITORY="s3:${CLUBIQ_R2_ENDPOINT%/}/${CLUBIQ_R2_BUCKET}/clubiq-ledger"

if ! restic snapshots --no-lock >/dev/null 2>&1; then
  restic init
fi

restic backup /backups/local --host="$(hostname)" --tag=automatic
now_epoch="$(date +%s)"
maintenance_file="/backups/local/.last-r2-maintenance"
check_file="/backups/local/.last-r2-check"
last_maintenance="$(cat "$maintenance_file" 2>/dev/null || echo 0)"
last_check="$(cat "$check_file" 2>/dev/null || echo 0)"
if (( now_epoch - last_maintenance >= 86400 )); then
  restic forget --keep-hourly 48 --keep-daily 35 --keep-weekly 12 --keep-monthly 13 --prune
  printf '%s' "$now_epoch" > "$maintenance_file"
fi
if (( now_epoch - last_check >= 604800 )); then
  restic check
  printf '%s' "$now_epoch" > "$check_file"
fi
printf '{"ok":true,"finishedAt":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > /backups/local/.last-r2-backup.json
