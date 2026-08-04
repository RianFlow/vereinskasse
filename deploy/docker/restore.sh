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

archive="${1:-}"
mode="${2:---preview}"
[[ "$mode" == "--preview" || "$mode" == "--execute" ]] || {
  echo "Verwendung: restore.sh ARCHIV [--preview|--execute]" >&2
  exit 2
}
[[ -f "$archive" && -f "$archive.sha256" ]] || {
  echo "Archiv oder Prüfsummendatei fehlt." >&2
  exit 1
}

resolved_archive="$(realpath "$archive")"
case "$resolved_archive" in
  /backups/local/*|/backups/usb/*) ;;
  *) echo "Es sind nur Sicherungen aus /backups/local oder /backups/usb erlaubt." >&2; exit 1 ;;
esac

(cd "$(dirname "$resolved_archive")" && sha256sum -c "$(basename "$resolved_archive").sha256") || {
  expected_checksum="$(awk 'NR==1 {print $1}' "$resolved_archive.sha256")"
  actual_checksum="$(sha256sum "$resolved_archive" | awk '{print $1}')"
  [[ -n "$expected_checksum" && "$expected_checksum" == "$actual_checksum" ]] || {
    echo "Prüfsumme der Sicherung ist ungültig." >&2
    exit 1
  }
}
while IFS= read -r entry; do
  case "$entry" in
    /*|../*|*/../*|*/..) echo "Unsicherer Pfad im Sicherungsarchiv: $entry" >&2; exit 1 ;;
  esac
done < <(tar -tzf "$resolved_archive")
while IFS= read -r permissions _; do
  case "${permissions:0:1}" in
    -|d) ;;
    *) echo "Links oder Spezialdateien im Sicherungsarchiv werden abgelehnt." >&2; exit 1 ;;
  esac
done < <(tar -tvzf "$resolved_archive")

read_secret PGPASSWORD
read_secret PGADMINPASSWORD
[[ "${PGDATABASE:-}" =~ ^[a-zA-Z0-9_]+$ && "${PGUSER:-}" =~ ^[a-zA-Z0-9_]+$ ]] || {
  echo "Unsichere PostgreSQL-Kennung abgelehnt." >&2
  exit 1
}

work="$(mktemp -d)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
preview_database="${PGDATABASE}_restore_preview_${stamp}_$$"
rollback_database="${PGDATABASE}_vor_restore_${stamp}"
database_cutover=false
objects_cutover=false
objects="${VEREINSKASSE_BACKUP_DIR:-/data/objects}"
objects_before="${objects}.vor-restore-${stamp}"
objects_new="${objects}.restore-${stamp}"

admin_psql() {
  PGPASSWORD="$PGADMINPASSWORD" psql --set=ON_ERROR_STOP=1 \
    --host="$PGHOST" --port="$PGPORT" --username="$PGADMINUSER" --dbname=postgres "$@"
}
admin_createdb() {
  PGPASSWORD="$PGADMINPASSWORD" createdb --host="$PGHOST" --port="$PGPORT" \
    --username="$PGADMINUSER" --owner="$PGUSER" "$@"
}
admin_dropdb() {
  PGPASSWORD="$PGADMINPASSWORD" dropdb --host="$PGHOST" --port="$PGPORT" \
    --username="$PGADMINUSER" --if-exists --force "$@"
}

cleanup() {
  if [[ "$database_cutover" != true ]]; then
    admin_dropdb "$preview_database" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$work"
}

rollback() {
  trap - ERR INT TERM
  echo "Wiederherstellung fehlgeschlagen; der vorherige Stand wird reaktiviert." >&2
  if [[ "$database_cutover" == true ]]; then
    admin_psql --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${PGDATABASE}' AND pid<>pg_backend_pid();" >/dev/null 2>&1 || true
    admin_psql --command="ALTER DATABASE \"${PGDATABASE}\" RENAME TO \"${preview_database}_fehlversuch\";" >/dev/null 2>&1 || true
    admin_psql --command="ALTER DATABASE \"${rollback_database}\" RENAME TO \"${PGDATABASE}\";" >/dev/null 2>&1 || true
  fi
  if [[ "$objects_cutover" == true && -d "$objects_before" ]]; then
    [[ -d "$objects" ]] && mv "$objects" "${objects}.fehlversuch-${stamp}" || true
    mv "$objects_before" "$objects" || true
  fi
  cleanup
  exit 1
}
trap cleanup EXIT

tar -xzf "$resolved_archive" -C "$work"
[[ -f "$work/data/vereinskasse.pgdump" ]] || {
  echo "Das Archiv enthält keine PostgreSQL-Sicherung." >&2
  exit 1
}
pg_restore --list "$work/data/vereinskasse.pgdump" >/dev/null

admin_createdb "$preview_database"
PGDATABASE="$preview_database" pg_restore --no-owner --no-acl --exit-on-error \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname="$preview_database" "$work/data/vereinskasse.pgdump"

tables="$(PGDATABASE="$preview_database" psql --tuples-only --no-align --command="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")"
members="$(PGDATABASE="$preview_database" psql --tuples-only --no-align --command='SELECT COUNT(*) FROM members')"
sales="$(PGDATABASE="$preview_database" psql --tuples-only --no-align --command='SELECT COUNT(*) FROM sales')"
[[ "$tables" -ge 20 ]] || {
  echo "Die Sicherung enthält nur $tables Tabellen und ist unvollständig." >&2
  exit 1
}

echo "Prüfsumme: gültig"
echo "Datenbank: $tables Tabellen vollständig lesbar"
echo "Mitglieder: $members"
echo "Buchungen: $sales"
echo "Sicherung: $(jq -r '.createdAt // "unbekannt"' "$work/manifest.json")"

if [[ "$mode" == "--preview" ]]; then
  echo "Nur Vorschau; der aktive Datenstand wurde nicht verändert."
  exit 0
fi

confirmation="${CLUBIQ_RESTORE_CONFIRMED:-}"
if [[ -z "$confirmation" ]]; then
  read -r -p "Zur Wiederherstellung exakt WIEDERHERSTELLEN eingeben: " confirmation
fi
[[ "$confirmation" == "WIEDERHERSTELLEN" ]] || {
  echo "Abgebrochen."
  exit 1
}

trap rollback ERR INT TERM
if [[ -d "$work/data/backups" ]]; then
  mkdir -p "$objects_new"
  cp -a "$work/data/backups/." "$objects_new/"
  chown -R node:node "$objects_new"
fi

admin_psql --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${PGDATABASE}' AND pid<>pg_backend_pid();"
admin_psql --command="ALTER DATABASE \"${PGDATABASE}\" RENAME TO \"${rollback_database}\";"
admin_psql --command="ALTER DATABASE \"${preview_database}\" RENAME TO \"${PGDATABASE}\";"
database_cutover=true

if [[ -d "$objects_new" ]]; then
  [[ -d "$objects" ]] && mv "$objects" "$objects_before"
  mv "$objects_new" "$objects"
  objects_cutover=true
fi

trap cleanup EXIT
echo "Wiederhergestellt. Der vorherige Datenbankstand bleibt als $rollback_database erhalten."
[[ -d "$objects_before" ]] && echo "Der vorherige Belegspeicher bleibt unter $objects_before erhalten."
