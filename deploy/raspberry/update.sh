#!/usr/bin/env bash
set -Eeuo pipefail

set -a
source /etc/vereinskasse/environment
set +a

repository="/opt/vereinskasse/repository.git"
releases="/opt/vereinskasse/releases"
current="/opt/vereinskasse/current"
branch="${VEREINSKASSE_GIT_BRANCH:-main}"
repo_url="${VEREINSKASSE_GIT_URL:-https://github.com/RianFlow/vereinskasse.git}"

mkdir -p "$releases"
if [[ ! -d "$repository" ]]; then
  git clone --mirror "$repo_url" "$repository"
else
  git --git-dir="$repository" remote update --prune
fi

commit="$(git --git-dir="$repository" rev-parse "refs/heads/$branch")"
release="$releases/$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:10}"
git clone --quiet --shared --branch "$branch" "$repository" "$release"
rm -rf "$release/.git"

cd "$release"
npm ci
npm run check:migrations
npm run typecheck
npm run build:raspberry
if [[ -x /usr/local/sbin/vereinskasse-backup &&
      ( "${VEREINSKASSE_DATABASE_PROVIDER:-sqlite}" == "postgres" ||
        -f "${VEREINSKASSE_DATABASE_PATH:-/var/lib/vereinskasse/data/vereinskasse.sqlite}" ) ]]; then
  /usr/local/sbin/vereinskasse-backup
fi
if [[ "${VEREINSKASSE_DATABASE_PROVIDER:-sqlite}" == "postgres" ]]; then
  node raspberry/postgres-admin.mjs migrate
fi
chown -R root:root "$release"
chmod -R a+rX "$release"

previous="$(readlink -f "$current" 2>/dev/null || true)"
next_link="/opt/vereinskasse/.current-next"
ln -sfn "$release" "$next_link"
mv -Tf "$next_link" "$current"
systemctl restart vereinskasse

healthy=false
for _ in {1..40}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:3000/ >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done
if [[ "$healthy" != true ]]; then
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" "$next_link"
    mv -Tf "$next_link" "$current"
    systemctl restart vereinskasse
  fi
  echo "Update fehlgeschlagen; vorherige Version wurde wieder aktiviert." >&2
  exit 1
fi

echo "Update aktiv: $commit"
