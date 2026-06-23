#!/usr/bin/env bash
# Build and reload SpashtAI on EC2 (run from repo root after .env is configured)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

echo "==> Python agent venv"
if [[ ! -x apps/agent/.venv312/bin/python ]]; then
  python3.12 -m venv apps/agent/.venv312
  apps/agent/.venv312/bin/pip install -r apps/agent/requirements.txt
fi

mkdir -p logs

echo "==> npm install"
npm ci

echo "==> Prisma"
cd apps/server
npm run prisma:generate
npx prisma migrate deploy
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

echo "==> PM2 reload"
if pm2 describe spashtai-api >/dev/null 2>&1; then
  pm2 reload infra/ec2/pm2/ecosystem.config.cjs
else
  pm2 start infra/ec2/pm2/ecosystem.config.cjs
fi
pm2 save

echo "Deploy complete. Check: pm2 status"
