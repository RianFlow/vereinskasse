#!/bin/sh
set -eu
umask 077
# Read bind-mounted root-only secrets once, then drop privileges. Never chmod the source files.
for secret_name in backoffice_secret backoffice_db_password smtp_password; do
  test -r "/run/secrets/$secret_name" || { echo "Verwaltungs-Secret fehlt: $secret_name" >&2; exit 1; }
  cp "/run/secrets/$secret_name" "/run/clubiq-backoffice/$secret_name"
  chown node:node "/run/clubiq-backoffice/$secret_name"
  chmod 0600 "/run/clubiq-backoffice/$secret_name"
done
chown node:node /run/clubiq-backoffice
chmod 0700 /run/clubiq-backoffice
export BACKOFFICE_SECRET_FILE=/run/clubiq-backoffice/backoffice_secret
export BACKOFFICE_DB_PASSWORD_FILE=/run/clubiq-backoffice/backoffice_db_password
export CLUBIQ_SMTP_PASSWORD_FILE=/run/clubiq-backoffice/smtp_password
exec gosu node "$@"
