#!/usr/bin/env bash
# Build and reload SpashtAI on EC2 (run from repo root after .env is configured).
#
# Typical production use:
#   ssh -i spashtai.pem ubuntu@13.219.136.19
#   cd /opt/spashtai && ./infra/ec2/deploy.sh
#
# Env:
#   SKIP_GIT_PULL=1     skip `git pull origin main`
#   SKIP_HEALTH_WAIT=1  skip waiting for /health after PM2 reload
#
# Safety: never git reset --hard, git clean, or prisma migrate reset.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

PROD_FILES=(
  infra/livekit/livekit.yaml
  infra/livekit/egress.yaml
  infra/ec2/env/postgres.env
  apps/server/.env
)

# Tracked files with production secrets/keys. Local copies must win over GitHub.
PROD_TRACKED_OVERLAYS=(
  infra/livekit/livekit.yaml
  infra/livekit/egress.yaml
)

# Last-known production LiveKit yaml. Survives a killed deploy; gitignored.
OVERLAY_BACKUP="${ROOT}/.deploy-overlay-backup"

is_prod_overlay() {
  local path="$1"
  local overlay
  for overlay in "${PROD_TRACKED_OVERLAYS[@]}"; do
    if [[ "${path}" == "${overlay}" ]]; then
      return 0
    fi
  done
  return 1
}

load_env_val() {
  local file="$1" key="$2"
  [[ -f "${file}" ]] || return 0
  local line
  line="$(grep -E "^${key}=" "${file}" | tail -1 || true)"
  [[ -n "${line}" ]] || return 0
  printf '%s' "${line#*=}" | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

backup_overlays() {
  mkdir -p "${OVERLAY_BACKUP}"
  local f
  for f in "${PROD_TRACKED_OVERLAYS[@]}"; do
    if [[ -f "${ROOT}/${f}" ]]; then
      cp -p "${ROOT}/${f}" "${OVERLAY_BACKUP}/$(basename "${f}")"
    fi
  done
}

restore_overlays() {
  [[ -d "${OVERLAY_BACKUP}" ]] || return 0
  local f
  for f in "${PROD_TRACKED_OVERLAYS[@]}"; do
    local bak="${OVERLAY_BACKUP}/$(basename "${f}")"
    if [[ -f "${bak}" ]]; then
      cp -p "${bak}" "${ROOT}/${f}"
    fi
  done
}

recover_overlays_if_reset_to_git() {
  [[ -d "${OVERLAY_BACKUP}" ]] || return 0
  local f
  for f in "${PROD_TRACKED_OVERLAYS[@]}"; do
    if git diff --quiet -- "${f}"; then
      local bak="${OVERLAY_BACKUP}/$(basename "${f}")"
      if [[ -f "${bak}" ]]; then
        cp -p "${bak}" "${ROOT}/${f}"
      fi
    fi
  done
}

trap restore_overlays EXIT

echo "==> Preflight"
# Only restore from backup when the working copy currently matches Git (interrupted checkout --).
# Never overwrite a live production overlay with a stale backup.
recover_overlays_if_reset_to_git
if [[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]]; then
  echo "Refusing to deploy from branch $(git rev-parse --abbrev-ref HEAD); expected main." >&2
  exit 1
fi

dirty=0
while IFS= read -r path; do
  [[ -z "${path}" ]] && continue
  if ! is_prod_overlay "${path}"; then
    dirty=1
    echo "  unexpected change: ${path}" >&2
  fi
done < <(git diff --name-only ; git diff --cached --name-only)
if [[ "${dirty}" -ne 0 ]]; then
  echo "Working tree has unexpected local modifications. Inspect them before deploying; do not git reset --hard." >&2
  git status --short
  exit 1
fi

missing=0
for f in "${PROD_FILES[@]}"; do
  if [[ ! -f "${ROOT}/${f}" ]]; then
    echo "Missing production file: ${f}" >&2
    missing=1
  fi
done
if [[ ! -f "${ROOT}/apps/agent/.env" && ! -f "${ROOT}/apps/agent/.env.bak" ]]; then
  echo "Missing production file: apps/agent/.env (or .env.bak)" >&2
  missing=1
fi
if [[ "${missing}" -ne 0 ]]; then
  exit 1
fi

backup_overlays

if [[ "${SKIP_GIT_PULL:-}" != "1" ]]; then
  echo "==> git pull --ff-only origin main"
  # Match HEAD for overlay files so pull cannot refuse or merge-over production keys.
  local_overlay=""
  for local_overlay in "${PROD_TRACKED_OVERLAYS[@]}"; do
    git checkout -- "${local_overlay}"
  done
  git pull --ff-only origin main
  git log -1 --oneline
  restore_overlays
fi

echo "==> Python agent venv"
RESOLVE_PY="${ROOT}/infra/ec2/resolve-python.sh"
chmod +x "${RESOLVE_PY}"
AGENT_PY="$("${RESOLVE_PY}")"
VENV_DIR="${ROOT}/apps/agent/.venv"
if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  "${AGENT_PY}" -m venv "${VENV_DIR}"
  "${VENV_DIR}/bin/pip" install -r apps/agent/requirements.txt
fi
echo "    Using ${VENV_DIR} ($("${VENV_DIR}/bin/python" --version))"

mkdir -p logs

echo "==> npm install"
npm ci

echo "==> Prisma"
cd apps/server
npm run prisma:generate
npx prisma migrate deploy
cd "${ROOT}"

echo "==> Build server + web"
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.spasht.ai}"
if [[ -z "${VITE_GOOGLE_CLIENT_ID:-}" ]]; then
  VITE_GOOGLE_CLIENT_ID="$(load_env_val "${ROOT}/apps/server/.env" GOOGLE_CLIENT_ID)"
  export VITE_GOOGLE_CLIENT_ID
fi
echo "    VITE_API_BASE_URL=${VITE_API_BASE_URL}"
if [[ -z "${VITE_GOOGLE_CLIENT_ID:-}" ]]; then
  echo "Warning: VITE_GOOGLE_CLIENT_ID not set — Google Sign-In will fail until set." >&2
fi
npm run build

if [[ ! -f "${ROOT}/apps/web/dist/index.html" ]]; then
  echo "Frontend build did not produce apps/web/dist/index.html — refusing rsync --delete." >&2
  exit 1
fi

echo "==> Sync web dist to /var/www/spashtai"
sudo rsync -a --delete apps/web/dist/ /var/www/spashtai/

echo "==> Nginx vhosts"
sudo cp infra/ec2/nginx/cloudflare-real-ip.conf /etc/nginx/snippets/cloudflare-real-ip.conf
sudo cp infra/ec2/nginx/spasht.ai.conf infra/ec2/nginx/api.spasht.ai.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/spasht.ai.conf /etc/nginx/sites-enabled/spasht.ai.conf
sudo ln -sf /etc/nginx/sites-available/api.spasht.ai.conf /etc/nginx/sites-enabled/api.spasht.ai.conf
if [[ -f /etc/letsencrypt/live/livekit.spasht.ai/fullchain.pem ]]; then
  sudo cp infra/ec2/nginx/livekit.spasht.ai.conf /etc/nginx/sites-available/livekit.spasht.ai.conf
  sudo ln -sf /etc/nginx/sites-available/livekit.spasht.ai.conf /etc/nginx/sites-enabled/livekit.spasht.ai.conf
else
  echo "Warning: livekit TLS cert missing — run ./infra/ec2/setup-livekit-tls.sh (Elevate WSS will fail until then)" >&2
fi
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "==> PM2 reload"
if pm2 describe spashtai-api >/dev/null 2>&1; then
  pm2 reload infra/ec2/pm2/ecosystem.config.cjs
else
  pm2 start infra/ec2/pm2/ecosystem.config.cjs
fi
pm2 save

if [[ "${SKIP_HEALTH_WAIT:-}" != "1" ]]; then
  echo "==> Wait for API health"
  healthy=0
  for _ in $(seq 1 30); do
    if curl -sf http://127.0.0.1:4000/health >/dev/null; then
      healthy=1
      break
    fi
    sleep 1
  done
  if [[ "${healthy}" -ne 1 ]]; then
    echo "API did not become healthy on http://127.0.0.1:4000/health" >&2
    pm2 status
    exit 1
  fi
  curl -sS http://127.0.0.1:4000/health
  echo
fi

pm2 status
echo "Deploy complete."
