#!/usr/bin/env bash
set -Eeuo pipefail

app_password_file="${POSTGRES_APP_PASSWORD_FILE:-/run/secrets/postgres_app_password}"
[[ -r "$app_password_file" ]] || {
  echo "PostgreSQL-App-Kennwort fehlt." >&2
  exit 1
}
app_password="$(<"$app_password_file")"

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$app_password" <<'SQL'
SELECT format('CREATE ROLE vereinskasse LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vereinskasse')
\gexec
ALTER ROLE vereinskasse WITH LOGIN PASSWORD :'app_password';
ALTER DATABASE vereinskasse OWNER TO vereinskasse;
REVOKE CONNECT ON DATABASE vereinskasse FROM PUBLIC;
GRANT CONNECT ON DATABASE vereinskasse TO vereinskasse;
ALTER SCHEMA public OWNER TO vereinskasse;
GRANT ALL ON SCHEMA public TO vereinskasse;
SQL

unset app_password
