#!/usr/bin/env bash
# Lightweight health + disk monitor for the single-box deploy.
#
# No monitoring stack required: it emits a WARN line (captured by cron → log)
# and, if ALERT_WEBHOOK_URL is set, POSTs a one-line alert (Slack/Discord/any
# webhook). Pair with a CloudWatch disk alarm later for always-on paging.
#
# Cron, every 5 min:
#   */5 * * * * ALERT_WEBHOOK_URL=https://... /opt/spashtai/infra/ec2/monitor.sh >> /opt/spashtai/logs/monitor.log 2>&1
set -uo pipefail

DISK_THRESH="${DISK_ALERT_PCT:-85}"
API_PORT="${API_PORT:-4000}"
WEBHOOK="${ALERT_WEBHOOK_URL:-}"
problems=()

# Root disk usage
USE=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
if [[ -n "${USE:-}" && "${USE}" -ge "${DISK_THRESH}" ]]; then
  problems+=("disk ${USE}% >= ${DISK_THRESH}%")
fi

# API readiness (DB-backed — distinguishes "process up" from "db down")
if ! curl -fsS --max-time 5 "http://127.0.0.1:${API_PORT}/ready" >/dev/null 2>&1; then
  problems+=("API /ready failing on :${API_PORT}")
fi

# Core dependency ports
for p in 5432 7880 8765; do
  nc -z 127.0.0.1 "$p" >/dev/null 2>&1 || problems+=("port ${p} not listening")
done

TS="$(date -u +%FT%TZ)"
if [[ "${#problems[@]}" -gt 0 ]]; then
  MSG="[spashtai-monitor] $(hostname): ${problems[*]}"
  echo "${TS} ${MSG}" >&2
  if [[ -n "${WEBHOOK}" ]]; then
    curl -fsS --max-time 5 -H 'Content-Type: application/json' \
      -d "$(printf '{"text":"%s"}' "${MSG}")" "${WEBHOOK}" >/dev/null 2>&1 || true
  fi
  exit 1
fi
echo "${TS} [spashtai-monitor] ok"
