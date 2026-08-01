#!/usr/bin/env bash
set -Eeuo pipefail

if [[ -r /etc/vereinskasse/environment ]]; then
  set -a
  source /etc/vereinskasse/environment
  set +a
fi

provider="${VEREINSKASSE_DATABASE_PROVIDER:-sqlite}"
database="${VEREINSKASSE_DATABASE_PATH:-/var/lib/vereinskasse/data/vereinskasse.sqlite}"
objects="${VEREINSKASSE_BACKUP_DIR:-/var/lib/vereinskasse/data/backups}"
destination="${VEREINSKASSE_OS_BACKUP_DIR:-/var/backups/vereinskasse}"
secondary="${VEREINSKASSE_SECONDARY_BACKUP_DIR:-}"
secondary_marker="${VEREINSKASSE_SECONDARY_REQUIRED_MARKER:-}"
retention_days="${VEREINSKASSE_BACKUP_RETENTION_DAYS:-35}"
secondary_retention_days="${VEREINSKASSE_USB_RETENTION_DAYS:-400}"
compression="${VEREINSKASSE_BACKUP_COMPRESSION:-6}"
[[ "$compression" =~ ^[0-9]$ && "$retention_days" =~ ^[0-9]+$ && "$secondary_retention_days" =~ ^[0-9]+$ ]] || {
  echo "Ungültige Sicherungsaufbewahrung oder Kompression." >&2
  exit 1
}

remove_archive() {
  local archive_path="$1"
  rm -f -- "$archive_path" "$archive_path.sha256"
}

thin_archives() {
  local directory="$1" older_than="$2" group_format="$3"
  declare -A kept=()
  local line timestamp archive_path epoch group
  while IFS='|' read -r timestamp archive_path; do
    [[ -n "$archive_path" ]] || continue
    epoch="${timestamp%%.*}"
    group="$(date -u -d "@$epoch" "+$group_format")"
    if [[ -n "${kept[$group]:-}" ]]; then
      remove_archive "$archive_path"
    else
      kept[$group]=1
    fi
  done < <(find "$directory" -maxdepth 1 -type f -name 'vereinskasse-*.tar.gz' \
    -mtime "+$older_than" -printf '%T@|%p\n' | sort -nr)
}

prune_archives() {
  local directory="$1" maximum_days="$2" monthly_after="${3:-0}"
  local archive_path
  while IFS= read -r archive_path; do
    [[ -n "$archive_path" ]] && remove_archive "$archive_path"
  done < <(find "$directory" -maxdepth 1 -type f -name 'vereinskasse-*.tar.gz' \
    -mtime "+$maximum_days" -print)
  thin_archives "$directory" 2 '%Y-%m-%d'
  if (( monthly_after > 0 )); then
    thin_archives "$directory" "$monthly_after" '%Y-%m'
  fi
}

if [[ "$destination" == "/" || ${#destination} -lt 10 ]]; then
  echo "Unsicheres Sicherungsziel abgelehnt." >&2
  exit 1
fi
if [[ "$provider" == "sqlite" && ! -f "$database" ]]; then
  echo "Keine Datenbank unter $database gefunden." >&2
  exit 1
fi

mkdir -p "$destination"
lock="$destination/.backup-running"
if ! mkdir "$lock" 2>/dev/null; then
  echo "Es läuft bereits eine Sicherung." >&2
  exit 1
fi
work="$(mktemp -d)"
trap 'rm -rf -- "$work"; rmdir "$lock" 2>/dev/null || true' EXIT
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
mkdir -p "$work/data"

if [[ "$provider" == "postgres" ]]; then
  pg_dump --format=custom --compress="$compression" --no-owner --no-acl \
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
  # Container-Sicherungen laufen absichtlich ohne CHOWN-Recht. Die Inhalte und
  # Metadaten bleiben erhalten; Benutzer-/Gruppenbesitz wird beim Restore neu
  # und passend zum Ziel gesetzt.
  cp -a --no-preserve=ownership "$objects" "$work/data/backups"
fi
printf '{"createdAt":"%s","hostname":"%s","provider":"%s","databaseCheck":"%s","sales":%s,"members":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(hostname)" "$provider" "$database_check" \
  "$sales_count" "$members_count" > "$work/manifest.json"

archive="$destination/vereinskasse-$stamp.tar.gz"
tar -C "$work" -czf "$archive" manifest.json data
(cd "$destination" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
chmod 600 "$archive" "$archive.sha256"

secondary_ready=false
if [[ -n "$secondary" && -d "$secondary" && -w "$secondary" ]]; then
  if [[ -z "$secondary_marker" || -f "$secondary/$secondary_marker" ]]; then
    secondary_ready=true
  else
    echo "USB-Sicherungsziel ohne Freigabemarkierung; lokale Sicherung bleibt gültig." >&2
  fi
fi
if [[ "$secondary_ready" == true ]]; then
  cp "$archive" "$archive.sha256" "$secondary/"
  prune_archives "$secondary" "$secondary_retention_days" 35
fi

prune_archives "$destination" "$retention_days"
echo "Sicherung erstellt und geprüft: $archive"
