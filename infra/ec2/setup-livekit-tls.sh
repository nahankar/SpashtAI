#!/usr/bin/env bash
# One-time: public TLS for livekit.spasht.ai (DNS-only / grey cloud in Cloudflare).
# Browsers connect directly to EC2 — Cloudflare origin certs are NOT publicly trusted.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOMAIN="livekit.spasht.ai"
EMAIL="${CERTBOT_EMAIL:-info@spasht.ai}"

echo "==> Prerequisites"
echo "    Cloudflare: livekit A record → EC2 IP, proxy OFF (grey cloud)"
echo "    Security group: ports 80 and 443 open"
echo ""

if ! command -v certbot >/dev/null 2>&1; then
  echo "==> Installing certbot"
  sudo apt-get update
  sudo apt-get install -y certbot python3-certbot-nginx
fi

echo "==> Obtaining Let's Encrypt certificate for ${DOMAIN}"
if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  sudo certbot certonly --nginx \
    -d "${DOMAIN}" \
    --non-interactive --agree-tos \
    -m "${EMAIL}" \
    --keep-until-expiring
else
  echo "    Certificate already exists — skipping certbot"
fi

echo "==> Installing nginx vhost (Let's Encrypt paths)"
sudo cp "${ROOT}/infra/ec2/nginx/livekit.spasht.ai.conf" /etc/nginx/sites-available/livekit.spasht.ai.conf
sudo ln -sf /etc/nginx/sites-available/livekit.spasht.ai.conf /etc/nginx/sites-enabled/livekit.spasht.ai.conf
sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "==> Verify (should show issuer: Let's Encrypt, not Cloudflare)"
echo "    curl -4 -sI https://${DOMAIN} | grep -E 'HTTP/|server:'"
curl -4 -sI "https://${DOMAIN}" | grep -E 'HTTP/|server:' || true
echo ""
echo "    openssl s_client -connect ${DOMAIN}:443 -servername ${DOMAIN} </dev/null 2>/dev/null | openssl x509 -noout -issuer"
openssl s_client -connect "${DOMAIN}:443" -servername "${DOMAIN}" </dev/null 2>/dev/null | openssl x509 -noout -issuer || true
