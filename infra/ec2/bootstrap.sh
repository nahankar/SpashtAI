#!/usr/bin/env bash
# SpashtAI EC2 bootstrap — Ubuntu 22.04/24.04, t3.large
# Run once on a fresh instance: ./infra/ec2/bootstrap.sh
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run as a normal user with sudo (not root)." >&2
  exit 1
fi

echo "==> System update"
sudo apt update
sudo apt upgrade -y

echo "==> Base packages"
sudo apt install -y \
  curl git build-essential nginx rsync \
  python3 python3-venv python3-pip \
  ca-certificates gnupg

# Prefer 3.12 when available (Ubuntu 22.04/24.04); newer Ubuntu may only ship 3.13+
if apt-cache show python3.12 >/dev/null 2>&1; then
  sudo apt install -y python3.12 python3.12-venv || true
fi

RESOLVE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/resolve-python.sh"
chmod +x "${RESOLVE_PY}"
AGENT_PY="$("${RESOLVE_PY}")"
echo "==> Python for agent: ${AGENT_PY} ($(${AGENT_PY} --version))"

echo "==> Node.js 22"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v

echo "==> PM2"
sudo npm install -g pm2
pm2 -v

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" |
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt update
  sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
sudo usermod -aG docker "${USER}"

echo "==> 2 GB swap (safety net on 8 GB instances)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "==> Cloudflare origin cert placeholders"
sudo mkdir -p /etc/ssl/cloudflare
if [[ ! -f /etc/ssl/cloudflare/spasht.ai.pem ]]; then
  sudo tee /etc/ssl/cloudflare/spasht.ai.pem >/dev/null <<'EOF'
# Paste Cloudflare Origin Certificate here (SSL/TLS → Origin Server)
EOF
fi
if [[ ! -f /etc/ssl/cloudflare/spasht.ai.key ]]; then
  sudo tee /etc/ssl/cloudflare/spasht.ai.key >/dev/null <<'EOF'
# Paste Cloudflare Origin Private Key here
EOF
  sudo chmod 600 /etc/ssl/cloudflare/spasht.ai.key
fi

echo "==> Web root"
sudo mkdir -p /var/www/spashtai
sudo chown -R "${USER}:${USER}" /var/www/spashtai

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -f "${REPO_ROOT}/infra/ec2/nginx/cloudflare-real-ip.conf" ]]; then
  echo "==> Nginx Cloudflare snippet"
  sudo cp "${REPO_ROOT}/infra/ec2/nginx/cloudflare-real-ip.conf" /etc/nginx/snippets/cloudflare-real-ip.conf
fi

mkdir -p "${REPO_ROOT}/logs"

echo ""
echo "Bootstrap complete."
echo "  1. Log out and back in (docker group)."
echo "  2. Paste Cloudflare origin cert/key into /etc/ssl/cloudflare/"
echo "  3. Copy infra/ec2/env/*.example → apps/server/.env, apps/agent/.env, infra/ec2/env/postgres.env"
echo "  4. Install Nginx sites: sudo cp infra/ec2/nginx/*.conf /etc/nginx/sites-available/ && sudo ln -sf ... sites-enabled/"
echo "  5. See docs/EC2-PRODUCTION.md"
