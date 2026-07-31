#!/usr/bin/env bash
set -Eeuo pipefail

set -a
source /etc/vereinskasse/environment
set +a

archive="${1:-}"
mode="${2:---preview}"
provider="${VEREINSKASSE_DATABASE_PROVIDER:-sqlite}"
database="${VEREINSKASSE_DATABASE_PATH:-/var/lib/vereinskasse/data/vereinskasse.sqlite}"
objects="${VEREINSKASSE_BACKUP_DIR:-/var/lib/vereinskasse/data/backups}"

[[ -f "$archive" && -f "$archive.sha256" ]] || {
  echo "Archiv oder Prüfsummendatei fehlt." >&2
  exit 1
}
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")

work="$(mktemp -d)"
preview_database=""
service_stopped=false
postgres_rollback_database=""
postgres_restore_complete=false
cleanup() {
  if [[ -n "$preview_database" ]]; then
    runuser -u postgres -- dropdb --if-exists --force "$preview_database" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$work"
  if [[ "$service_stopped" == true ]]; then
    if [[ "$provider" == "postgres" && -n "$postgres_rollback_database" && "$postgres_restore_complete" != true ]]; then
      runuser -u postgres -- dropdb --if-exists --force "$PGDATABASE" >/dev/null 2>&1 || true
      runuser -u postgres -- psql --set=ON_ERROR_STOP=1 \
        --command="ALTER DATABASE \"${postgres_rollback_database}\" RENAME TO \"${PGDATABASE}\";" >/dev/null 2>&1 || true
    fi
    systemctl start vereinskasse || true
  fi
}
trap cleanup EXIT
tar -xzf "$archive" -C "$work"

if [[ -f "$work/data/vereinskasse.pgdump" ]]; then
  archive_provider="postgres"
elif [[ -f "$work/data/vereinskasse.sqlite" ]]; then
  archive_provider="sqlite"
else
  echo "Das Archiv enthält keine erkannte Datenbank." >&2
  exit 1
fi
[[ "$archive_provider" == "$provider" ]] || {
  echo "Die Sicherung gehört zu $archive_provider, die aktive Kasse verwendet $provider." >&2
  exit 1
}

if [[ "$provider" == "postgres" ]]; then
  [[ "$PGDATABASE" =~ ^[a-zA-Z0-9_]+$ && "$PGUSER" =~ ^[a-zA-Z0-9_]+$ ]] || {
    echo "Unsichere PostgreSQL-Kennung abgelehnt." >&2
    exit 1
  }
  pg_restore --list "$work/data/vereinskasse.pgdump" >/dev/null
  preview_database="${PGDATABASE}_restore_preview_$$"
  runuser -u postgres -- createdb --owner="$PGUSER" "$preview_database"
  PGDATABASE="$preview_database" pg_restore --no-owner --no-acl --exit-on-error \
    --dbname="$preview_database" "$work/data/vereinskasse.pgdump"
  if [[ "$(PGDATABASE="$preview_database" psql --tuples-only --no-align --command="SELECT COALESCE(to_regclass('public.sales')::text,'')")" == "sales" ]]; then
    sales_count="$(PGDATABASE="$preview_database" psql --tuples-only --no-align --command='SELECT COUNT(*) FROM sales')"
    members_count="$(PGDATABASE="$preview_database" psql --tuples-only --no-align --command='SELECT COUNT(*) FROM members')"
  else
    sales_count=0
    members_count=0
  fi
  runuser -u postgres -- dropdb --force "$preview_database"
  preview_database=""
else
  integrity="$(sqlite3 "$work/data/vereinskasse.sqlite" "PRAGMA integrity_check;")"
  [[ "$integrity" == "ok" ]] || {
    echo "Datenbank im Archiv ist beschädigt: $integrity" >&2
    exit 1
  }
  sales_count="$(sqlite3 "$work/data/vereinskasse.sqlite" 'SELECT COUNT(*) FROM sales;')"
  members_count="$(sqlite3 "$work/data/vereinskasse.sqlite" 'SELECT COUNT(*) FROM members;')"
fi

echo "Prüfsumme: gültig"
echo "Datenbank: vollständig lesbar ($provider)"
echo "Sicherung: $(sed -n 's/.*"createdAt":"\([^"]*\)".*/\1/p' "$work/manifest.json")"
echo "Buchungen: $sales_count"
echo "Mitglieder: $members_count"

if [[ "$mode" != "--execute" ]]; then
  echo "Nur Vorschau. Ausführen mit: sudo vereinskasse-restore '$archive' --execute"
  exit 0
fi

read -r -p "Zur Wiederherstellung exakt WIEDERHERSTELLEN eingeben: " confirmation
[[ "$confirmation" == "WIEDERHERSTELLEN" ]] || {
  echo "Abgebrochen."
  exit 1
}

systemctl stop vereinskasse
service_stopped=true
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ "$provider" == "postgres" ]]; then
  rollback_database="${PGDATABASE}_vor_restore_${stamp}"
  runuser -u postgres -- psql --set=ON_ERROR_STOP=1 \
    --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${PGDATABASE}' AND pid<>pg_backend_pid();"
  runuser -u postgres -- psql --set=ON_ERROR_STOP=1 \
    --command="ALTER DATABASE \"${PGDATABASE}\" RENAME TO \"${rollback_database}\";"
  postgres_rollback_database="$rollback_database"
  if ! runuser -u postgres -- createdb --owner="$PGUSER" "$PGDATABASE" || \
    ! pg_restore --no-owner --no-acl --exit-on-error --dbname="$PGDATABASE" \
      "$work/data/vereinskasse.pgdump"; then
    echo "Wiederherstellung fehlgeschlagen; vorherige Datenbank wurde reaktiviert." >&2
    exit 1
  fi
  rollback="$rollback_database"
else
  rollback="${database}.vor-wiederherstellung-${stamp}"
  if [[ -f "$database" ]]; then
    sqlite3 "$database" ".backup '$rollback'"
  fi
  install -o vereinskasse -g vereinskasse -m 600 \
    "$work/data/vereinskasse.sqlite" "$database.new"
  mv "$database.new" "$database"
  rm -f "${database}-wal" "${database}-shm"
fi

if [[ -d "$work/data/backups" ]]; then
  mkdir -p "$objects"
  cp -a "$work/data/backups/." "$objects/"
  chown -R vereinskasse:vereinskasse "$objects"
fi
systemctl start vereinskasse
postgres_restore_complete=true
service_stopped=false
echo "Wiederhergestellt. Vorheriger Stand bleibt erhalten als: $rollback"
