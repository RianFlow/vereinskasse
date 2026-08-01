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
CREATE ROLE vereinskasse LOGIN;
ALTER ROLE vereinskasse PASSWORD :'app_password';
ALTER DATABASE vereinskasse OWNER TO vereinskasse;
REVOKE CONNECT ON DATABASE vereinskasse FROM PUBLIC;
GRANT CONNECT ON DATABASE vereinskasse TO vereinskasse;
SQL

unset app_password

