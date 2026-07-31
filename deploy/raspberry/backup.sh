#!/usr/bin/env bash
set -Eeuo pipefail

set -a
source /etc/vereinskasse/environment
set +a

provider="${VEREINSKASSE_DATABASE_PROVIDER:-sqlite}"
database="${VEREINSKASSE_DATABASE_PATH:-/var/lib/vereinskasse/data/vereinskasse.sqlite}"
objects="${VEREINSKASSE_BACKUP_DIR:-/var/lib/vereinskasse/data/backups}"
destination="${VEREINSKASSE_OS_BACKUP_DIR:-/var/backups/vereinskasse}"
secondary="${VEREINSKASSE_SECONDARY_BACKUP_DIR:-}"

if [[ "$destination" == "/" || ${#destination} -lt 10 ]]; then
  echo "Unsicheres Sicherungsziel abgelehnt." >&2
  exit 1
fi
if [[ "$provider" == "sqlite" && ! -f "$database" ]]; then
  echo "Keine Datenbank unter $database gefunden." >&2
  exit 1
fi

mkdir -p "$destination"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
mkdir -p "$work/data"

if [[ "$provider" == "postgres" ]]; then
  pg_dump --format=custom --compress=9 --no-owner --no-acl \
    --file="$work/data/vereinskasse.pgdump" "$PGDATABASE"
  pg_restore --list "$work/data/vereinskasse.pgdump" >/dev/null
  if [[ "$(psql --tuples-only --no-align --command="SELECT COALESCE(to_regclass('public.sales')::text,'')")" == "sales" ]]; then
    sales_count="$(psql --tuples-only --no-align --command='SELECT COUNT(*) FROM sales')"
    members_count="$(psql --tuples-only --no-align --command='SELECT COUNT(*) FROM members')"
  else
    sales_count=0
    members_count=0
  fi
  database_check="pg_restore-list-ok"
else
  sqlite3 "$database" ".timeout 10000" ".backup '$work/data/vereinskasse.sqlite'"
  integrity="$(sqlite3 "$work/data/vereinskasse.sqlite" "PRAGMA integrity_check;")"
  [[ "$integrity" == "ok" ]] || {
    echo "Datenbankprüfung fehlgeschlagen: $integrity" >&2
    exit 1
  }
  sales_count="$(sqlite3 "$work/data/vereinskasse.sqlite" 'SELECT COUNT(*) FROM sales;')"
  members_count="$(sqlite3 "$work/data/vereinskasse.sqlite" 'SELECT COUNT(*) FROM members;')"
  database_check="integrity-ok"
fi

if [[ -d "$objects" ]]; then
  cp -a "$objects" "$work/data/backups"
fi
printf '{"createdAt":"%s","hostname":"%s","provider":"%s","databaseCheck":"%s","sales":%s,"members":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(hostname)" "$provider" "$database_check" \
  "$sales_count" "$members_count" > "$work/manifest.json"

archive="$destination/vereinskasse-$stamp.tar.gz"
tar -C "$work" -czf "$archive" manifest.json data
sha256sum "$archive" > "$archive.sha256"
chmod 600 "$archive" "$archive.sha256"

if [[ -n "$secondary" && -d "$secondary" && -w "$secondary" ]]; then
  cp "$archive" "$archive.sha256" "$secondary/"
fi

find "$destination" -maxdepth 1 -type f -name 'vereinskasse-*.tar.gz' -mtime +35 -delete
find "$destination" -maxdepth 1 -type f -name 'vereinskasse-*.tar.gz.sha256' -mtime +35 -delete
echo "Sicherung erstellt und geprüft: $archive"
