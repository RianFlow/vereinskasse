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

stage_runtime_secret() {
  local file_variable="$1"
  local filename="$2"
  local source="${!file_variable:-}"
  [[ -n "$source" ]] || return 0
  [[ -r "$source" ]] || {
    echo "Geheimnisdatei für $file_variable ist nicht lesbar." >&2
    exit 1
  }
  local runtime_directory="/tmp/clubiq-runtime-secrets"
  local target="$runtime_directory/$filename"
  install -d -o root -g node -m 0710 "$runtime_directory"
  # Das tmpfs bleibt bei einem Container-Neustart erhalten. Eine bereits
  # gestufte Datei wird daher über das root-eigene Verzeichnis ersetzt.
  rm -f "$target"
  # Erst den endgültigen Modus setzen und danach den Eigentümer wechseln:
  # Der gehärtete Container besitzt CHOWN, absichtlich aber kein FOWNER.
  install -m 0400 "$source" "$target"
  chown node:node "$target"
  printf -v "$file_variable" '%s' "$target"
  export "$file_variable"
}

read_secret PGPASSWORD
read_secret VEREINSKASSE_INITIAL_PROFILE_PIN
stage_runtime_secret CLUBIQ_SMTP_PASSWORD_FILE smtp_password
stage_runtime_secret CLUBIQ_MONTHLY_MAIL_TOKEN_FILE monthly_mail_token

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
