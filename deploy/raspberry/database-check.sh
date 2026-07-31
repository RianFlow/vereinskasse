#!/usr/bin/env bash
set -Eeuo pipefail

set -a
source /etc/vereinskasse/environment
set +a

cd /opt/vereinskasse/current
node raspberry/postgres-admin.mjs check
