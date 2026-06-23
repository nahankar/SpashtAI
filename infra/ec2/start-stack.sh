#!/usr/bin/env bash
# Production Docker stack: Postgres + LiveKit + Gentle (no local STT/TTS/Ollama)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

POSTGRES_ENV="${ROOT}/infra/ec2/env/postgres.env"
G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'

cmd="${1:-start}"

ensure_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo -e "${R}Docker is not running or user lacks docker group.${N} Log out/in after bootstrap." >&2
    exit 1
  fi
}

start_postgres() {
  echo -e "${B}→ Postgres${N}"
  if [[ -f "${POSTGRES_ENV}" ]]; then
    docker compose -f infra/postgres/docker-compose.yml --env-file "${POSTGRES_ENV}" up -d
  else
    echo -e "${Y}  Warning: ${POSTGRES_ENV} missing — using default password. Create from postgres.env.example${N}"
    docker compose -f infra/postgres/docker-compose.yml up -d
  fi
}

start_livekit() {
  echo -e "${B}→ LiveKit (+ redis, egress)${N}"
  if [[ ! -f infra/livekit/livekit.yaml ]]; then
    echo -e "${R}Missing infra/livekit/livekit.yaml — copy livekit.prod.yaml.example and set keys.${N}" >&2
    exit 1
  fi
  docker compose -f infra/livekit/docker-compose.yml up -d
}

start_gentle() {
  echo -e "${B}→ Gentle (delivery WPM/pauses)${N}"
  # Only the gentle service — skip gentle-compose redis (LiveKit already uses :6379)
  docker compose -f infra/gentle/docker-compose.yml up -d gentle
}

stop_all() {
  docker compose -f infra/gentle/docker-compose.yml stop gentle 2>/dev/null || true
  docker compose -f infra/livekit/docker-compose.yml down 2>/dev/null || true
  docker compose -f infra/postgres/docker-compose.yml down 2>/dev/null || true
  echo -e "${G}Stack stopped${N}"
}

status() {
  echo -e "${B}=== Docker ===${N}"
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' \
    | grep -E 'spashtai|livekit|gentle|NAMES' || true
  echo ""
  echo -e "${B}=== Health ===${N}"
  for tuple in "Postgres:5432" "LiveKit:7880" "Gentle:8765"; do
    label="${tuple%%:*}"; port="${tuple##*:}"
    if nc -z localhost "${port}" 2>/dev/null; then
      echo -e "  ${G}✓${N} ${label} :${port}"
    else
      echo -e "  ${R}✗${N} ${label} :${port}"
    fi
  done
}

case "${cmd}" in
  start)
    ensure_docker
    start_postgres
    start_livekit
    start_gentle
    echo ""
    status
    ;;
  stop) ensure_docker; stop_all ;;
  restart) ensure_docker; stop_all; start_postgres; start_livekit; start_gentle ;;
  status) ensure_docker; status ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
