#!/bin/sh
set -eu
image="${1:-clubiq-backoffice:test}"
directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# Disposable container-only fixtures, no live secrets, database or host writes.
docker run --rm --read-only \
  --cap-drop ALL --cap-add CHOWN --cap-add SETUID --cap-add SETGID \
  --security-opt no-new-privileges:true \
  --tmpfs /run/secrets:rw,noexec,nosuid,size=1m \
  --tmpfs /run/clubiq-backoffice:rw,noexec,nosuid,size=1m \
  --mount "type=bind,src=$directory/container-start-check.mjs,dst=/entrypoint-check.mjs,readonly" \
  --entrypoint /bin/sh "$image" -eu -c '
    umask 077
    for name in backoffice_secret backoffice_db_password smtp_password; do
      printf "%s\n" "disposable-test-fixture" > "/run/secrets/$name"
    done
    exec /usr/local/bin/clubiq-backoffice-entrypoint node /entrypoint-check.mjs
  '
