#!/usr/bin/env bash
set -Eeuo pipefail

read_secret() {
  local target="$1"
  local file_variable="${target}_FILE"
  local file="${!file_variable:-}"
  [[ -n "$file" && -r "$file" ]] || { echo "Geheimnisdatei für $target fehlt." >&2; exit 1; }
  printf -v "$target" '%s' "$(<"$file")"
  export "$target"
}

[[ "${CLUBIQ_R2_ENABLED:-false}" == "true" ]] || { echo "R2 ist nicht eingerichtet." >&2; exit 1; }
[[ "${CLUBIQ_R2_ENDPOINT:-}" == https://* && -n "${CLUBIQ_R2_BUCKET:-}" ]] || { echo "R2-Einstellungen fehlen." >&2; exit 1; }
read_secret AWS_ACCESS_KEY_ID
read_secret AWS_SECRET_ACCESS_KEY
[[ -r "${RESTIC_PASSWORD_FILE:-}" ]] || { echo "Restic-Kennwortdatei fehlt." >&2; exit 1; }

export AWS_DEFAULT_REGION=auto
export RESTIC_REPOSITORY="s3:${CLUBIQ_R2_ENDPOINT%/}/${CLUBIQ_R2_BUCKET}/clubiq-ledger"
snapshot="${1:-latest}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

restic check
restic restore "$snapshot" --target "$work"
source_archive="$(find "$work/backups/local" -maxdepth 1 -type f -name 'vereinskasse-*.tar.gz' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
[[ -n "$source_archive" && -f "$source_archive" ]] || { echo "Im R2-Snapshot wurde kein Kassenarchiv gefunden." >&2; exit 1; }

stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
destination="/backups/local/r2-wiederhergestellt-${stamp}.tar.gz"
cp "$source_archive" "$destination"
(cd /backups/local && sha256sum "$(basename "$destination")" > "$(basename "$destination").sha256")
chmod 600 "$destination" "$destination.sha256"
echo "R2-Sicherung lokal bereitgestellt: $destination"
echo "Jetzt prüfen mit: clubiq wiederherstellen $destination"

