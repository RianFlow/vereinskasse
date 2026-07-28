#!/usr/bin/env bash
set -Eeuo pipefail

source /etc/vereinskasse/environment

database="${VEREINSKASSE_DATABASE_PATH:-/var/lib/vereinskasse/data/vereinskasse.sqlite}"
objects="${VEREINSKASSE_BACKUP_DIR:-/var/lib/vereinskasse/data/backups}"
destination="${VEREINSKASSE_OS_BACKUP_DIR:-/var/backups/vereinskasse}"
secondary="${VEREINSKASSE_SECONDARY_BACKUP_DIR:-}"

if [[ ! -f "$database" ]]; then
  echo "Keine Datenbank unter $database gefunden." >&2
  exit 1
fi
if [[ "$destination" == "/" || ${#destination} -lt 10 ]]; then
  echo "Unsicheres Sicherungsziel abgelehnt." >&2
  exit 1
fi

mkdir -p "$destination"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"

sqlite3 "$database" ".timeout 10000" ".backup '$work/vereinskasse.sqlite'"
integrity="$(sqlite3 "$work/vereinskasse.sqlite" "PRAGMA integrity_check;")"
[[ "$integrity" == "ok" ]] || {
  echo "Datenbankprüfung fehlgeschlagen: $integrity" >&2
  exit 1
}

mkdir -p "$work/data"
mv "$work/vereinskasse.sqlite" "$work/data/"
if [[ -d "$objects" ]]; then
  cp -a "$objects" "$work/data/backups"
fi
printf '{"createdAt":"%s","hostname":"%s","databaseIntegrity":"ok"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(hostname)" > "$work/manifest.json"

archive="$destination/vereinskasse-$stamp.tar.gz"
tar -C "$work" -czf "$archive" manifest.json data
sha256sum "$archive" > "$archive.sha256"
chmod 600 "$archive" "$archive.sha256"

if [[ -n "$secondary" && -d "$secondary" && -w "$secondary" ]]; then
  cp "$archive" "$archive.sha256" "$secondary/"
fi

find "$destination" -maxdepth 1 -type f -name 'vereinskasse-*.tar.gz' -mtime +35 -delete
find "$destination" -maxdepth 1 -type f -name 'vereinskasse-*.tar.gz.sha256' -mtime +35 -delete
echo "Sicherung erstellt: $archive"
