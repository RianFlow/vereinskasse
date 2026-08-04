#!/usr/bin/env bash
set -Eeuo pipefail

set -a
source /etc/vereinskasse/environment
set +a

[[ "${VEREINSKASSE_DATABASE_PROVIDER:-sqlite}" == "postgres" ]] || {
  echo "Der saubere Neustart ist nur für die PostgreSQL-Laufzeit freigeschaltet." >&2
  exit 1
}
[[ "$PGDATABASE" =~ ^[a-zA-Z0-9_]+$ && "$PGUSER" =~ ^[a-zA-Z0-9_]+$ ]] || {
  echo "Unsichere PostgreSQL-Kennung abgelehnt." >&2
  exit 1
}

echo "Es wird eine neue, leere Vereinskasse angelegt."
echo "Die bisherige Datenbank wird gesichert und als Archivdatenbank behalten."
read -r -p "Zum Fortfahren exakt NEUE DATENBANK eingeben: " confirmation
[[ "$confirmation" == "NEUE DATENBANK" ]] || {
  echo "Abgebrochen."
  exit 1
}

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
objects="${VEREINSKASSE_BACKUP_DIR:-/var/lib/vereinskasse/data/backups}"
[[ "$objects" != "/" && ${#objects} -ge 10 ]] || {
  echo "Unsicherer Belegspeicherpfad abgelehnt." >&2
  exit 1
}
archive_objects="${objects}.test-archiv-${stamp}"
service_stopped=false
database_renamed=false
objects_moved=false

rollback() {
  trap - ERR INT TERM
  if [[ "$service_stopped" == true ]]; then
    systemctl stop vereinskasse >/dev/null 2>&1 || true
  fi
  if [[ "$database_renamed" == true ]]; then
    runuser -u postgres -- dropdb --if-exists --force "$PGDATABASE" >/dev/null 2>&1 || true
    runuser -u postgres -- psql --set=ON_ERROR_STOP=1 \
      --command="ALTER DATABASE \"${archive_database}\" RENAME TO \"${PGDATABASE}\";" >/dev/null 2>&1 || true
  fi
  if [[ "$objects_moved" == true && -d "$archive_objects" ]]; then
    if [[ -e "$objects" ]]; then
      mv "$objects" "${objects}.fehlversuch-${stamp}" || true
    fi
    mv "$archive_objects" "$objects" || true
  fi
  if [[ "$service_stopped" == true ]]; then
    systemctl start vereinskasse || true
  fi
  exit 1
}
trap rollback ERR INT TERM

/usr/local/sbin/vereinskasse-backup
systemctl stop vereinskasse
service_stopped=true
runuser -u postgres -- psql --set=ON_ERROR_STOP=1 \
  --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${PGDATABASE}' AND pid<>pg_backend_pid();"
runuser -u postgres -- psql --set=ON_ERROR_STOP=1 \
  --command="ALTER DATABASE \"${PGDATABASE}\" RENAME TO \"${archive_database}\";"
database_renamed=true
runuser -u postgres -- createdb --owner="$PGUSER" "$PGDATABASE"
if [[ -d "$objects" ]]; then
  mv "$objects" "$archive_objects"
  objects_moved=true
fi
install -d -o vereinskasse -g vereinskasse -m 750 "$objects"

cd /opt/vereinskasse/current
node raspberry/postgres-admin.mjs migrate
VEREINSKASSE_INITIAL_PROFILE_PIN="$initial_pin" node raspberry/postgres-admin.mjs bootstrap
unset initial_pin initial_pin_repeat
systemctl start vereinskasse
sleep 2
curl --fail --silent --max-time 5 http://127.0.0.1:3000/api/profiles >/dev/null
service_stopped=false
trap - ERR INT TERM

echo "Neue saubere Datenbank ist aktiv."
echo "Der bisherige Teststand bleibt vorläufig erhalten als: $archive_database"
echo "Der bisherige Belegspeicher bleibt erhalten unter: $archive_objects"
