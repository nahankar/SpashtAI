#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SpashtAI local pipeline stack
#
# Brings up STT (speaches / faster-whisper) and TTS (Kokoro-FastAPI) as
# Docker containers behind OpenAI-compatible APIs that LiveKit's openai plugin
# can talk to. Ollama is assumed to already be running on :11434
# (started via `brew services start ollama`).
#
# Usage:
#   ./start-local-stack.sh start    # default: bring everything up
#   ./start-local-stack.sh stop     # stop containers (keeps data volumes)
#   ./start-local-stack.sh status   # show running containers + port checks
#   ./start-local-stack.sh logs     # tail logs from STT + TTS
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

STT_NAME="spashtai-stt"
STT_IMAGE="ghcr.io/speaches-ai/speaches:latest-cpu"
STT_PORT_HOST=8001
STT_PORT_CTR=8000

TTS_NAME="spashtai-tts"
TTS_IMAGE="ghcr.io/remsky/kokoro-fastapi-cpu:latest"
TTS_PORT_HOST=8002
TTS_PORT_CTR=8880

OLLAMA_PORT=11434

# Colors
G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'

cmd="${1:-start}"

ensure_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo -e "${R}✗ Docker is not running.${N} Start Colima with:  colima start" >&2
    exit 1
  fi
}

start_stt() {
  if docker ps --format '{{.Names}}' | grep -q "^${STT_NAME}$"; then
    echo -e "${Y}• STT (${STT_NAME}) already running on :${STT_PORT_HOST}${N}"
    return
  fi
  if docker ps -a --format '{{.Names}}' | grep -q "^${STT_NAME}$"; then
    docker rm -f "${STT_NAME}" >/dev/null
  fi
  echo -e "${B}→ Starting STT (faster-whisper / speaches) on :${STT_PORT_HOST}${N}"
  docker run -d \
    --name "${STT_NAME}" \
    --restart unless-stopped \
    -p "${STT_PORT_HOST}:${STT_PORT_CTR}" \
    -v spashtai-stt-cache:/home/ubuntu/.cache \
    -e WHISPER__MODEL=Systran/faster-distil-whisper-small.en \
    "${STT_IMAGE}" >/dev/null
  echo -e "${G}✓ STT started${N}"
}

start_tts() {
  if docker ps --format '{{.Names}}' | grep -q "^${TTS_NAME}$"; then
    echo -e "${Y}• TTS (${TTS_NAME}) already running on :${TTS_PORT_HOST}${N}"
    return
  fi
  if docker ps -a --format '{{.Names}}' | grep -q "^${TTS_NAME}$"; then
    docker rm -f "${TTS_NAME}" >/dev/null
  fi
  echo -e "${B}→ Starting TTS (Kokoro-FastAPI) on :${TTS_PORT_HOST}${N}"
  docker run -d \
    --name "${TTS_NAME}" \
    --restart unless-stopped \
    -p "${TTS_PORT_HOST}:${TTS_PORT_CTR}" \
    "${TTS_IMAGE}" >/dev/null
  echo -e "${G}✓ TTS started${N}"
}

stop_all() {
  for n in "${STT_NAME}" "${TTS_NAME}"; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${n}$"; then
      docker stop "$n" >/dev/null 2>&1 || true
      docker rm   "$n" >/dev/null 2>&1 || true
      echo -e "${G}✓ Stopped ${n}${N}"
    fi
  done
}

status() {
  echo -e "${B}=== Containers ===${N}"
  docker ps --filter "name=${STT_NAME}" --filter "name=${TTS_NAME}" \
    --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

  echo ""
  echo -e "${B}=== Port checks ===${N}"
  for tuple in "STT:${STT_PORT_HOST}" "TTS:${TTS_PORT_HOST}" "Ollama:${OLLAMA_PORT}"; do
    label="${tuple%%:*}"; port="${tuple##*:}"
    if curl -sf -o /dev/null --max-time 2 "http://localhost:${port}/" 2>/dev/null \
        || curl -sf -o /dev/null --max-time 2 "http://localhost:${port}/v1/models" 2>/dev/null; then
      echo -e "  ${G}✓${N} ${label} on :${port}"
    else
      echo -e "  ${R}✗${N} ${label} on :${port} (not responding)"
    fi
  done
}

logs() {
  echo -e "${B}=== STT logs (last 20 lines) ===${N}"
  docker logs --tail 20 "${STT_NAME}" 2>&1 || echo "STT not running"
  echo ""
  echo -e "${B}=== TTS logs (last 20 lines) ===${N}"
  docker logs --tail 20 "${TTS_NAME}" 2>&1 || echo "TTS not running"
}

case "$cmd" in
  start)
    ensure_docker
    start_stt
    start_tts
    echo ""
    echo -e "${G}Stack starting up. First boot downloads models (~1-2 min).${N}"
    echo -e "Run: ${B}./start-local-stack.sh status${N} to verify."
    echo -e "Make sure Ollama is also running:  ${B}brew services start ollama${N}"
    ;;
  stop)
    ensure_docker
    stop_all
    ;;
  restart)
    ensure_docker
    stop_all
    start_stt
    start_tts
    ;;
  status)
    ensure_docker
    status
    ;;
  logs)
    ensure_docker
    logs
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
