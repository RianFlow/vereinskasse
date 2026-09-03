#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "$EUID" -eq 0 ]] || { echo 'Bitte mit sudo ausführen.' >&2; exit 1; }
directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd -- "$directory/../.." && pwd)"
cd "$directory"
test -f .env
compose=(docker compose --env-file .env -f compose.yaml -f backoffice.compose.yaml)
# Fail before any database or secret changes if the explicit origin is missing.
"${compose[@]}" config --quiet
test -s secrets/smtp_password || { echo 'Bitte zuerst den Mailversand der Kasse einrichten.' >&2; exit 1; }
test -s secrets/postgres_admin_password
for name in backoffice_secret backoffice_db_password; do
  if [[ ! -s "secrets/$name" ]]; then
    openssl rand -hex 48 > "secrets/$name"
    chmod 0600 "secrets/$name"
  fi
done
admin_compose=(docker compose --env-file .env -f compose.yaml)
db_password="$(<secrets/backoffice_db_password)"
[[ "$db_password" =~ ^[a-f0-9]{96}$ ]] || { echo 'Unerwartetes Format des separaten Verwaltungs-DB-Kennworts.' >&2; exit 1; }
# Pipe SQL via stdin, never put passwords in output or docker command arguments.
{
  printf "SELECT format('CREATE ROLE clubiq_backoffice LOGIN PASSWORD %%L', '%s') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='clubiq_backoffice')\n\\gexec\n" "$db_password"
  printf "ALTER ROLE clubiq_backoffice WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '%s';\n" "$db_password"
  # Bounded, additive table only; the cash update also records this migration.
  cat "$root/postgres/migrations/0007_configuration_state.sql"
  printf '\nGRANT SELECT,INSERT,UPDATE ON public.configuration_state TO vereinskasse;\n'
  cat "$root/backoffice/grants.sql"
} | "${admin_compose[@]}" exec -T postgres sh -c 'export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"; exec psql -X -v ON_ERROR_STOP=1 -U clubiq_admin -d vereinskasse' >/dev/null
unset db_password
"${compose[@]}" build backoffice
"${compose[@]}" run --rm --no-deps backoffice node --experimental-strip-types manage.mjs migrate
"${compose[@]}" up -d --no-deps --wait --wait-timeout 90 backoffice
curl --fail --silent --show-error http://127.0.0.1:8092/health
# Keep the opt-in service in later clubiq updates; never treat it as an orphan.
touch .backoffice-enabled
chmod 0600 .backoffice-enabled
printf '\nVerwaltung lokal bereit. Noch keine öffentliche Domain-Freigabe vorgenommen.\n'
printf 'Nächste Schritte: erstes persönliches Konto einladen, Sicherung prüfen, dann Cloudflare Access + Tunnel einrichten.\n'
