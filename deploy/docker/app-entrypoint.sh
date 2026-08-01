#!/usr/bin/env bash
set -Eeuo pipefail

read_secret() {
  local target="$1"
  local file_variable="${target}_FILE"
  local file="${!file_variable:-}"
  if [[ -n "$file" ]]; then
    [[ -r "$file" ]] || {
      echo "Geheimnisdatei für $target ist nicht lesbar." >&2
      exit 1
    }
    printf -v "$target" '%s' "$(<"$file")"
    export "$target"
  fi
}

read_secret PGPASSWORD
read_secret VEREINSKASSE_INITIAL_PROFILE_PIN

mkdir -p "${VEREINSKASSE_DATA_DIR:-/data}" "${VEREINSKASSE_BACKUP_DIR:-/data/objects}"
chown -R node:node "${VEREINSKASSE_DATA_DIR:-/data}"

for attempt in $(seq 1 60); do
  if gosu node node raspberry/postgres-admin.mjs wait >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == 60 ]]; then
    echo "PostgreSQL ist nach 60 Sekunden noch nicht mit den App-Zugangsdaten erreichbar." >&2
    gosu node node raspberry/postgres-admin.mjs wait
    exit 1
  fi
  sleep 1
done

gosu node node raspberry/postgres-admin.mjs migrate
gosu node node raspberry/postgres-admin.mjs bootstrap
unset VEREINSKASSE_INITIAL_PROFILE_PIN

exec gosu node node raspberry/start-production.mjs
