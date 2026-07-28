#!/usr/bin/env bash
set -Eeuo pipefail

source /etc/vereinskasse/environment

archive="${1:-}"
mode="${2:---preview}"
database="${VEREINSKASSE_DATABASE_PATH:-/var/lib/vereinskasse/data/vereinskasse.sqlite}"
objects="${VEREINSKASSE_BACKUP_DIR:-/var/lib/vereinskasse/data/backups}"

[[ -f "$archive" && -f "$archive.sha256" ]] || {
  echo "Archiv oder Prüfsummendatei fehlt." >&2
  exit 1
}
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")

work="$(mktemp -d)"
service_stopped=false
cleanup() {
  rm -rf -- "$work"
  if [[ "$service_stopped" == true ]]; then
    systemctl start vereinskasse || true
  fi
}
trap cleanup EXIT
tar -xzf "$archive" -C "$work"
[[ -f "$work/data/vereinskasse.sqlite" ]] || {
  echo "Das Archiv enthält keine Datenbank." >&2
  exit 1
}
integrity="$(sqlite3 "$work/data/vereinskasse.sqlite" "PRAGMA integrity_check;")"
[[ "$integrity" == "ok" ]] || {
  echo "Datenbank im Archiv ist beschädigt: $integrity" >&2
  exit 1
}

echo "Prüfsumme: gültig"
echo "Datenbank: vollständig"
echo "Sicherung: $(sed -n 's/.*\"createdAt\":\"\\([^\"]*\\)\".*/\\1/p' "$work/manifest.json")"
echo "Buchungen: $(sqlite3 "$work/data/vereinskasse.sqlite" 'SELECT COUNT(*) FROM sales;')"
echo "Mitglieder: $(sqlite3 "$work/data/vereinskasse.sqlite" 'SELECT COUNT(*) FROM members;')"

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
rollback="${database}.vor-wiederherstellung-$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -f "$database" ]]; then
  sqlite3 "$database" ".backup '$rollback'"
fi
install -o vereinskasse -g vereinskasse -m 600 \
  "$work/data/vereinskasse.sqlite" "$database.new"
mv "$database.new" "$database"
rm -f "${database}-wal" "${database}-shm"
if [[ -d "$work/data/backups" ]]; then
  mkdir -p "$objects"
  cp -a "$work/data/backups/." "$objects/"
  chown -R vereinskasse:vereinskasse "$objects"
fi
systemctl start vereinskasse
service_stopped=false
echo "Wiederhergestellt. Vorherige Datenbank: $rollback"
