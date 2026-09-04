#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="${CLUBIQ_PROJECT_DIR:-/opt/clubiq-ledger/deploy/docker}"
[[ -f "$project_dir/.env" && -f "$project_dir/compose.yaml" ]] || {
  echo "ClubIQ-Installation nicht gefunden: $project_dir" >&2
  exit 1
}

compose=(docker compose --project-directory "$project_dir" --env-file "$project_dir/.env" -f "$project_dir/compose.yaml")
if [[ -f "$project_dir/.backoffice-enabled" ]]; then
  compose+=(-f "$project_dir/backoffice.compose.yaml")
fi

for attempt in $(seq 1 30); do
  docker info >/dev/null 2>&1 && break
  if [[ "$attempt" -eq 30 ]]; then
    echo "Docker wurde nach dem Systemstart nicht bereit." >&2
    exit 1
  fi
  sleep 2
done

tailscale_serve_was_active=false
resume_tailscale() {
  [[ "$tailscale_serve_was_active" == true ]] || return 0
  tailscale serve --bg http://127.0.0.1:8090 >/dev/null
  tailscale_serve_was_active=false
  echo "Privater Tailscale-Zugang ist wieder aktiv."
}
trap resume_tailscale EXIT

if command -v tailscale >/dev/null 2>&1; then
  serve_status="$(tailscale serve status 2>/dev/null || true)"
  if [[ "$serve_status" == *"http://127.0.0.1:8090"* ]]; then
    tailscale_serve_was_active=true
    tailscale serve --https=443 off >/dev/null
    echo "Privater Tailscale-Zugang wurde für den Proxy-Start kurz pausiert."
  fi
fi

# Docker kann bestehende Container nach einem harten Neustart starten, ohne alle
# Portregeln wiederherzustellen. Der zustandslose Caddy-Proxy wird deshalb bei
# jedem Boot gezielt neu erstellt; Datenbank und Anwendungsdaten bleiben bestehen.
"${compose[@]}" up -d --remove-orphans
"${compose[@]}" up -d --no-deps --force-recreate proxy

for attempt in $(seq 1 60); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:8090/api/profiles >/dev/null; then
    break
  fi
  if [[ "$attempt" -eq 60 ]]; then
    echo "Die Kasse ist nach dem Systemstart nicht über Port 8090 erreichbar." >&2
    exit 1
  fi
  sleep 2
done

if [[ -f "$project_dir/.backoffice-enabled" ]]; then
  for attempt in $(seq 1 45); do
    if curl --fail --silent --max-time 3 http://127.0.0.1:8092/health >/dev/null; then
      break
    fi
    if [[ "$attempt" -eq 45 ]]; then
      echo "Die Verwaltung ist nach dem Systemstart nicht über Port 8092 erreichbar." >&2
      exit 1
    fi
    sleep 2
  done
fi

resume_tailscale
trap - EXIT
echo "ClubIQ Kasse und Verwaltung sind nach dem Systemstart erreichbar."
