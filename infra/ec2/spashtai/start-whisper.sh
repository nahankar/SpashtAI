#!/usr/bin/env bash
# Whisper STT (speaches / faster-whisper) for SpashtAI pipeline-bedrock.
# Run on the SpashtAI instance (or any host reachable by the agent at :8001).
# Only needed when using self-hosted Whisper instead of AWS Transcribe.
set -euo pipefail

STT_NAME="spashtai-stt"
STT_IMAGE="ghcr.io/speaches-ai/speaches:latest-cpu"
STT_PORT_HOST=8001
STT_PORT_CTR=8000
WHISPER_MODEL="${WHISPER_MODEL:-deepdml/faster-whisper-large-v3-turbo-ct2}"

G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'
cmd="${1:-start}"

ensure_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo -e "${R}✗ Docker is not running.${N}" >&2
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
  echo -e "${B}→ Starting Whisper STT (${WHISPER_MODEL}) on :${STT_PORT_HOST}${N}"
  docker run -d \
    --name "${STT_NAME}" \
    --restart unless-stopped \
    --memory=3g \
    --cpus=1.5 \
    -p "${STT_PORT_HOST}:${STT_PORT_CTR}" \
    -v spashtai-stt-cache:/home/ubuntu/.cache \
    -e "WHISPER__MODEL=${WHISPER_MODEL}" \
    "${STT_IMAGE}" >/dev/null
  echo -e "${G}✓ STT started on :${STT_PORT_HOST}. If on a remote host, allow TCP ${STT_PORT_HOST} from the agent's SG.${N}"
}

stop_stt() {
  if docker ps -a --format '{{.Names}}' | grep -q "^${STT_NAME}$"; then
    docker stop "${STT_NAME}" >/dev/null 2>&1 || true
    docker rm "${STT_NAME}" >/dev/null 2>&1 || true
    echo -e "${G}✓ Stopped ${STT_NAME}${N}"
  fi
}

status() {
  docker ps --filter "name=${STT_NAME}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  if curl -sf -o /dev/null --max-time 3 "http://localhost:${STT_PORT_HOST}/v1/models" 2>/dev/null; then
    echo -e "${G}✓ STT responding on :${STT_PORT_HOST}${N}"
  else
    echo -e "${R}✗ STT not responding on :${STT_PORT_HOST}${N}"
  fi
}

case "$cmd" in
  start) ensure_docker; start_stt ;;
  stop) ensure_docker; stop_stt ;;
  restart) ensure_docker; stop_stt; start_stt ;;
  status) ensure_docker; status ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
