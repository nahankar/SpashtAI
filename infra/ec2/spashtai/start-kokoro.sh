#!/usr/bin/env bash
# Kokoro TTS for SpashtAI pipeline-bedrock — run on SpashtAI EC2 (localhost:8002)
set -euo pipefail

TTS_NAME="spashtai-tts"
TTS_IMAGE="ghcr.io/remsky/kokoro-fastapi-cpu:latest"
TTS_PORT_HOST=8002
TTS_PORT_CTR=8880

G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'
cmd="${1:-start}"

ensure_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo -e "${R}✗ Docker is not running.${N}" >&2
    exit 1
  fi
}

start_tts() {
  if docker ps --format '{{.Names}}' | grep -q "^${TTS_NAME}$"; then
    echo -e "${Y}• TTS (${TTS_NAME}) already running on :${TTS_PORT_HOST}${N}"
    return
  fi
  if docker ps -a --format '{{.Names}}' | grep -q "^${TTS_NAME}$"; then
    docker rm -f "${TTS_NAME}" >/dev/null
  fi
  echo -e "${B}→ Starting Kokoro TTS on :${TTS_PORT_HOST}${N}"
  docker run -d \
    --name "${TTS_NAME}" \
    --restart unless-stopped \
    -p "${TTS_PORT_HOST}:${TTS_PORT_CTR}" \
    "${TTS_IMAGE}" >/dev/null
  echo -e "${G}✓ TTS started${N}"
}

stop_tts() {
  if docker ps -a --format '{{.Names}}' | grep -q "^${TTS_NAME}$"; then
    docker stop "${TTS_NAME}" >/dev/null 2>&1 || true
    docker rm "${TTS_NAME}" >/dev/null 2>&1 || true
    echo -e "${G}✓ Stopped ${TTS_NAME}${N}"
  fi
}

status() {
  docker ps --filter "name=${TTS_NAME}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  if curl -sf -o /dev/null --max-time 3 "http://localhost:${TTS_PORT_HOST}/" 2>/dev/null; then
    echo -e "${G}✓ TTS responding on :${TTS_PORT_HOST}${N}"
  else
    echo -e "${R}✗ TTS not responding on :${TTS_PORT_HOST}${N}"
  fi
}

case "$cmd" in
  start) ensure_docker; start_tts ;;
  stop) ensure_docker; stop_tts ;;
  restart) ensure_docker; stop_tts; start_tts ;;
  status) ensure_docker; status ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
