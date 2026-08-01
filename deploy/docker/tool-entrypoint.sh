#!/usr/bin/env bash
set -Eeuo pipefail

read_secret_if_present() {
  local target="$1"
  local file_variable="${target}_FILE"
  local file="${!file_variable:-}"
  if [[ -n "$file" && -r "$file" ]]; then
    printf -v "$target" '%s' "$(<"$file")"
    export "$target"
  fi
}

read_secret_if_present PGPASSWORD
read_secret_if_present PGADMINPASSWORD
exec "$@"

