#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-agent/esp32-ble-onboarding-v2}"
REPO_DIR="/home/svbarverdarts/vereinskasse"
DOCKER_DIR="$REPO_DIR/deploy/docker"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Repository not found at $REPO_DIR"
  echo "Cloning repo..."
  sudo mkdir -p /home/svbarverdarts
  sudo chown -R svbarverdarts:svbarverdarts /home/svbarverdarts
  cd /home/svbarverdarts
  git clone https://github.com/RianFlow/vereinskasse.git
fi

cd "$REPO_DIR"
echo "==> Switching to branch $BRANCH"
git fetch origin
if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  git checkout "$BRANCH"
else
  git checkout -b "$BRANCH" "origin/$BRANCH"
fi
git pull --ff-only origin "$BRANCH"

echo "==> Building and starting Docker stack"
cd "$DOCKER_DIR"
docker compose up --build -d

echo "==> Container status"
docker compose ps

echo "==> Done"
