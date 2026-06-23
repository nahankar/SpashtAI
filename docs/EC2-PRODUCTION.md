# SpashtAI — EC2 Production (dedicated t3.large)

Single **Ubuntu 26.04 LTS** EC2 instance for SpashtAI beta/production:

- **Cloudflare** terminates public TLS (no Certbot on the box)
- **AWS Bedrock / Nova** for live voice, Replay, and coaching insights — **no** Ollama, local STT, or local TTS
- **Docker**: Postgres, LiveKit, Gentle (delivery metrics)
- **PM2**: Node API + Python LiveKit agent
- **Nginx**: static web, API reverse proxy, LiveKit WebSocket proxy

Related: [Google Sign-In production](./GOOGLE-SIGNIN-PRODUCTION.md)

---

## Architecture

```text
                    Cloudflare (SSL at edge)
                              │
        ┌─────────────────────┼─────────────────────┐
        │ proxied (orange)    │ DNS only (grey)     │
        ▼                     ▼                     │
   spasht.ai            livekit.spasht.ai          │
   api.spasht.ai              │                   │
        │                     │                   │
        └──────────┬──────────┘                   │
                   ▼                             │
            EC2 t3.large (8 GB)                  │
    ┌──────────────────────────────────┐         │
    │ Nginx (:443 origin cert)         │         │
    │  ├─ /var/www/spashtai → web dist │         │
    │  ├─ api → :4000 (PM2)            │         │
    │  └─ livekit → :7880 (WS/WSS)     │         │
    ├──────────────────────────────────┤         │
    │ PM2: spashtai-api, spashtai-agent│         │
    ├──────────────────────────────────┤         │
    │ Docker: Postgres, LiveKit, Gentle│         │
    └──────────────────────────────────┘         │
                   │                             │
                   ▼                             │
              AWS Bedrock / S3 / Transcribe ◄────┘
```

| Subdomain | Cloudflare proxy | Why |
|-----------|------------------|-----|
| `spasht.ai` | **Proxied** | Static SPA + assets |
| `api.spasht.ai` | **Proxied** | REST API |
| `livekit.spasht.ai` | **DNS only (grey cloud)** | WebRTC needs direct UDP to EC2 |

---

## 1 — AWS: EC2 + security group

| Type | Port | Source | Purpose |
|------|------|--------|---------|
| SSH | 22 | Your IP | Admin |
| HTTP | 80 | 0.0.0.0/0 | Redirect / ACME (optional) |
| HTTPS | 443 | 0.0.0.0/0 | Nginx (Cloudflare → origin) |
| TCP | 7880–7881 | 0.0.0.0/0 | LiveKit signaling |
| UDP | 7882 | 0.0.0.0/0 | LiveKit RTC |
| UDP | 50000–60000 | 0.0.0.0/0 | LiveKit media ports (`livekit.yaml`) |

**Do not** expose `4000`, `5432`, `4001`, or `8765` publicly.

Instance: **t3.large** (2 vCPU, 8 GB) — adequate for beta with Bedrock voice (no local LLM stack).

---

## 2 — Cloudflare DNS + SSL

### DNS records

| Name | Type | Content | Proxy |
|------|------|---------|-------|
| `@` | A | `<EC2_PUBLIC_IP>` | Proxied |
| `www` | CNAME | `spasht.ai` | Proxied |
| `api` | A | `<EC2_PUBLIC_IP>` | Proxied |
| `livekit` | A | `<EC2_PUBLIC_IP>` | **DNS only** |

### SSL/TLS settings (Cloudflare dashboard)

1. **SSL/TLS → Overview**: **Full (strict)**
2. **SSL/TLS → Origin Server → Create Certificate**
   - Hostnames: `spasht.ai`, `*.spasht.ai`
   - Key: RSA, 15 years
   - Save **Origin Certificate** and **Private Key**
3. On EC2:

```bash
sudo mkdir -p /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/spasht.ai.pem      # paste origin cert
sudo nano /etc/ssl/cloudflare/spasht.ai.key      # paste private key
sudo chmod 600 /etc/ssl/cloudflare/spasht.ai.key
```

4. **SSL/TLS → Edge Certificates**: enable **Always Use HTTPS**
5. **Network**: enable **WebSockets** (for API if needed)

### Why LiveKit is grey-cloud

Cloudflare’s HTTP proxy does not carry WebRTC UDP. `livekit.spasht.ai` must resolve directly to EC2. Nginx on `:443` still terminates TLS using the same Cloudflare origin certificate.

---

## 3 — Bootstrap the server

SSH into the instance, clone the repo, run bootstrap:

```bash
git clone https://github.com/YOUR_ORG/SpashtAI.git /opt/spashtai
cd /opt/spashtai
chmod +x infra/ec2/*.sh
./infra/ec2/bootstrap.sh
```

Log out and back in (docker group), then install origin certs (step 2), then:

```bash
cd /opt/spashtai
sudo cp infra/ec2/nginx/cloudflare-real-ip.conf /etc/nginx/snippets/cloudflare-real-ip.conf
sudo cp infra/ec2/nginx/spasht.ai.conf infra/ec2/nginx/api.spasht.ai.conf infra/ec2/nginx/livekit.spasht.ai.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/spasht.ai.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/api.spasht.ai.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/livekit.spasht.ai.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## 4 — Environment files (AWS-only, no local LLMs)

Copy templates and edit secrets:

```bash
cp infra/ec2/env/postgres.env.example infra/ec2/env/postgres.env
cp infra/ec2/env/server.env.example apps/server/.env
cp infra/ec2/env/agent.env.example apps/agent/.env
```

Generate secrets:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # INTERNAL_AGENT_TOKEN
```

### Server (`apps/server/.env`) — highlights

| Variable | Production value |
|----------|------------------|
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | `https://spasht.ai` |
| `INSIGHT_PROVIDER` | `bedrock-text` (not `local-audio`) |
| `LIVEKIT_URL` | `wss://livekit.spasht.ai` |
| `GENTLE_URL` | `http://127.0.0.1:8765` |
| `JWT_SECRET` | long random |
| `INTERNAL_AGENT_TOKEN` | long random (must match agent) |

Do **not** set `LOCAL_AUDIO_INSIGHT_URL`, Ollama URLs, or local pipeline URLs in production.

### Agent (`apps/agent/.env`) — highlights

| Variable | Production value |
|----------|------------------|
| `ENVIRONMENT` | `production` |
| `LIVEKIT_URL` | `wss://livekit.spasht.ai` |
| `SERVER_URL` | `https://api.spasht.ai` |
| `FORCE_LOCAL_STORAGE` | `false` |
| `AUDIO_S3_BUCKET` | your S3 bucket |

Voice backend defaults to **nova-sonic** (Bedrock) via admin voice config — no local STT/TTS containers.

### LiveKit keys

Generate production keys (on EC2 or locally):

```bash
docker run --rm livekit/livekit-server:latest livekit-server generate-keys
```

1. Put the key pair in `infra/livekit/livekit.yaml` under `keys:` (replace `devkey` / `devsecret`)
2. Set the same values in `apps/server/.env` and `apps/agent/.env`
3. Copy prod config:

```bash
cp infra/livekit/livekit.prod.yaml.example infra/livekit/livekit.yaml
# edit keys + confirm use_external_ip: true
```

---

## 5 — Start Docker stack

```bash
cd /opt/spashtai
./infra/ec2/start-stack.sh start
./infra/ec2/start-stack.sh status
```

Starts **Postgres**, **LiveKit** (+ Redis for egress), and **Gentle** only. Does **not** start local STT/TTS/Ollama.

Apply database schema:

```bash
cd apps/server
npm run prisma:generate
npx prisma migrate deploy
```

---

## 6 — Build and deploy app

```bash
cd /opt/spashtai

# Frontend build-time vars (baked into dist/)
export VITE_API_BASE_URL=https://api.spasht.ai
export VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com

npm ci
npm run build
sudo mkdir -p /var/www/spashtai
sudo rsync -a --delete apps/web/dist/ /var/www/spashtai/

pm2 start infra/ec2/pm2/ecosystem.config.cjs
pm2 save
pm2 startup   # run the printed sudo command once
```

Or use the helper:

```bash
./infra/ec2/deploy.sh
```

---

## 7 — PM2 processes

| Name | Command | Port |
|------|---------|------|
| `spashtai-api` | `node dist/index.js` | 4000 (localhost) |
| `spashtai-agent` | `python main.py start` | worker (LiveKit) |

```bash
pm2 status
pm2 logs spashtai-api
pm2 logs spashtai-agent
```

---

## 8 — Smoke test

1. `https://spasht.ai` loads (SPA)
2. `https://api.spasht.ai/api/health` returns healthy (or your health route)
3. Sign in (Google + email)
4. Start **Elevate** session — coach greets, audio flows via Bedrock Nova Sonic
5. End session — Delivery tab shows WPM (Gentle may take time on long audio)
6. **Replay** analysis uses Bedrock Nova Pro

---

## 9 — What we intentionally skip in prod

| Local dev service | Prod |
|-------------------|------|
| Ollama (`:11434`) | **Off** — use Bedrock |
| STT speaches (`:8001`) | **Off** — Nova Sonic |
| TTS Kokoro (`:8002`) | **Off** — Nova Sonic |
| `start-local-stack.sh` | **Do not run** |
| `pipeline-premium` voice backend | **Off** — use `nova-sonic` only |
| Vite dev server (`:5173`) | **Off** — Nginx serves `dist/` |

---

## 10 — Updates

```bash
cd /opt/spashtai
git pull
./infra/ec2/deploy.sh
```

---

## 11 — Troubleshooting

| Symptom | Check |
|---------|-------|
| 502 on API | `pm2 logs spashtai-api`, `DATABASE_URL`, migrations |
| Elevate won’t connect | LiveKit grey-cloud DNS, UDP ports, `LIVEKIT_URL=wss://...` |
| Agent not joining room | `pm2 logs spashtai-agent`, AWS creds, LiveKit keys match |
| WebRTC fails behind CF | Confirm `livekit` is **not** orange-cloud proxied |
| Delivery WPM empty | `GENTLE_URL`, `docker ps` gentle, CPU load on t3.large |
| Coaching insights fail | `INSIGHT_PROVIDER=bedrock-text`, Bedrock model access in IAM |

---

## File reference

| Path | Purpose |
|------|---------|
| `infra/ec2/bootstrap.sh` | OS packages: Node 22, PM2, Nginx, Docker, swap |
| `infra/ec2/start-stack.sh` | Postgres + LiveKit + Gentle |
| `infra/ec2/deploy.sh` | Build, migrate, sync web, PM2 reload |
| `infra/ec2/nginx/*.conf` | Nginx vhosts (Cloudflare origin TLS) |
| `infra/ec2/pm2/ecosystem.config.cjs` | PM2 app definitions |
| `infra/ec2/env/*.example` | Env templates |
