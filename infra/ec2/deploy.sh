#!/usr/bin/env bash
# Build and reload SpashtAI on EC2 (run from repo root after .env is configured)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

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
# Migrations may lag schema on fresh EC2 — push adds missing columns/tables
npx prisma db push
cd "${ROOT}"

echo "==> Build server + web"
if [[ -z "${VITE_API_BASE_URL:-}" ]]; then
  echo "Warning: VITE_API_BASE_URL not set — using https://api.spasht.ai" >&2
  export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.spasht.ai}"
fi
if [[ -z "${VITE_GOOGLE_CLIENT_ID:-}" ]]; then
  echo "Warning: VITE_GOOGLE_CLIENT_ID not set — Google Sign-In will fail until set." >&2
fi
npm run build

echo "==> Sync web dist to /var/www/spashtai"
sudo rsync -a --delete apps/web/dist/ /var/www/spashtai/

echo "==> Nginx vhosts"
sudo cp infra/ec2/nginx/cloudflare-real-ip.conf /etc/nginx/snippets/cloudflare-real-ip.conf
sudo cp infra/ec2/nginx/spasht.ai.conf infra/ec2/nginx/api.spasht.ai.conf infra/ec2/nginx/livekit.spasht.ai.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/spasht.ai.conf /etc/nginx/sites-enabled/spasht.ai.conf
sudo ln -sf /etc/nginx/sites-available/api.spasht.ai.conf /etc/nginx/sites-enabled/api.spasht.ai.conf
sudo ln -sf /etc/nginx/sites-available/livekit.spasht.ai.conf /etc/nginx/sites-enabled/livekit.spasht.ai.conf
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

echo "Deploy complete. Check: pm2 status"
