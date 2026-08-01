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

read_secret PGPASSWORD
read_secret PGADMINPASSWORD
[[ "${PGDATABASE:-}" =~ ^[a-zA-Z0-9_]+$ && "${PGUSER:-}" =~ ^[a-zA-Z0-9_]+$ ]] || {
  echo "Unsichere PostgreSQL-Kennung abgelehnt." >&2
  exit 1
}

echo "Es wird eine neue leere Vereinskasse angelegt; der Teststand bleibt als Archiv erhalten."
read -r -p "Zum Fortfahren exakt NEUE DATENBANK eingeben: " confirmation
[[ "$confirmation" == "NEUE DATENBANK" ]] || { echo "Abgebrochen."; exit 1; }

while true; do
  read -r -s -p "Erste sechsstellige Profil-PIN: " initial_pin
  echo
  read -r -s -p "PIN wiederholen: " initial_pin_repeat
  echo
  [[ "$initial_pin" =~ ^[0-9]{6}$ && "$initial_pin" == "$initial_pin_repeat" ]] && break
  echo "Die PIN muss aus sechs Ziffern bestehen und zweimal gleich sein."
done

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive_database="${PGDATABASE}_test_archiv_${stamp}"
objects="${VEREINSKASSE_BACKUP_DIR:-/data/objects}"
archive_objects="${objects}.test-archiv-${stamp}"
database_renamed=false
objects_moved=false

admin_psql() {
  PGPASSWORD="$PGADMINPASSWORD" psql --set=ON_ERROR_STOP=1 --host="$PGHOST" \
    --port="$PGPORT" --username="$PGADMINUSER" --dbname=postgres "$@"
}
admin_createdb() {
  PGPASSWORD="$PGADMINPASSWORD" createdb --host="$PGHOST" --port="$PGPORT" \
    --username="$PGADMINUSER" --owner="$PGUSER" "$@"
}

rollback() {
  trap - ERR INT TERM
  echo "Neustart fehlgeschlagen; der Teststand wird reaktiviert." >&2
  if [[ "$database_renamed" == true ]]; then
    admin_psql --command="DROP DATABASE IF EXISTS \"${PGDATABASE}\" WITH (FORCE);" >/dev/null 2>&1 || true
    admin_psql --command="ALTER DATABASE \"${archive_database}\" RENAME TO \"${PGDATABASE}\";" >/dev/null 2>&1 || true
  fi
  if [[ "$objects_moved" == true && -d "$archive_objects" ]]; then
    [[ -d "$objects" ]] && mv "$objects" "${objects}.fehlversuch-${stamp}" || true
    mv "$archive_objects" "$objects" || true
  fi
  exit 1
}
trap rollback ERR INT TERM

admin_psql --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${PGDATABASE}' AND pid<>pg_backend_pid();"
admin_psql --command="ALTER DATABASE \"${PGDATABASE}\" RENAME TO \"${archive_database}\";"
database_renamed=true
admin_createdb "$PGDATABASE"

if [[ -d "$objects" ]]; then
  mv "$objects" "$archive_objects"
  objects_moved=true
fi
mkdir -p "$objects"
chown -R node:node "$objects"

node raspberry/postgres-admin.mjs migrate
VEREINSKASSE_INITIAL_PROFILE_PIN="$initial_pin" node raspberry/postgres-admin.mjs bootstrap
unset initial_pin initial_pin_repeat
node raspberry/postgres-admin.mjs check
trap - ERR INT TERM

echo "Neue saubere Datenbank ist aktiv."
echo "Testdatenbank: $archive_database"
[[ -d "$archive_objects" ]] && echo "Alter Belegspeicher: $archive_objects"

