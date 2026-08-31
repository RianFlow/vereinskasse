#!/usr/bin/env bash
set -Eeuo pipefail
token_file="/opt/clubiq-ledger/deploy/docker/secrets/monthly_mail_token"
[[ -s "$token_file" ]] || { echo "Monatsmail-Token fehlt." >&2; exit 1; }
token="$(cat "$token_file")"
response="$(curl --fail --silent --show-error --max-time 120 --retry 5 --retry-delay 10 --retry-all-errors -X POST -H "X-ClubIQ-Monthly-Token: $token" http://127.0.0.1:8090/api/email/monthly-close)"
unset token
printf '%s\n' "$response"
