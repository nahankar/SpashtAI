# SpashtAI - Local Development Setup

## Architecture Overview

SpashtAI consists of **4 services** that need to be running for the full application to work:

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (Frontend)                  │
│              http://localhost:5173 (Vite)                │
└───────────────┬──────────────────────┬──────────────────┘
                │ REST API             │ WebSocket (LiveKit)
                ▼                      ▼
┌──────────────────────┐   ┌──────────────────────────────┐
│   Backend Server     │   │   LiveKit Server (Docker)    │
│  http://localhost:4000│   │   ws://localhost:7880        │
│  (Node.js / Express) │   │                              │
└──────────┬───────────┘   └──────────┬───────────────────┘
           │                          │
           │ Prisma ORM               │ Agent Worker
           ▼                          ▼
┌──────────────────────┐   ┌──────────────────────────────┐
│   PostgreSQL (Aiven)  │   │   LiveKit Agent (Python)     │
│   Cloud-hosted DB     │   │   apps/agent/main.py         │
│                       │   │   (AWS Bedrock / NovaSonic)  │
└───────────────────────┘   └──────────────────────────────┘
```

## Prerequisites

- **Node.js** >= 18 (v24 confirmed working)
- **Python** 3.12 (for LiveKit agent)
- **Docker Desktop** (or Rancher Desktop) for LiveKit server
- **npm** (comes with Node.js)

## Services & How to Start Each

### 1. LiveKit Server (Docker container)

**What it does:** Real-time audio/video communication server for the Elevate module.

**Check if running:**
```bash
docker ps | grep livekit-server
```

**Start if not running:**
```bash
docker run -d \
  --name livekit-server \
  -p 7880:7880 \
  -p 7881:7881 \
  -p 7882:7882/udp \
  -v $(pwd)/infra/livekit/livekit.yaml:/etc/livekit.yaml \
  livekit/livekit-server:latest \
  --config /etc/livekit.yaml
```

**Config:** `infra/livekit/livekit.yaml` (API key: `devkey`, secret: `devsecret`)

---

### 2. Backend Server (Node.js / Express)

**What it does:** REST API for auth, sessions, replay analysis, metrics, LiveKit token generation.

**Start:**
```bash
npm run dev:server
```

**Runs on:** http://localhost:4000

**Config:** `apps/server/.env`

**Key env vars:**
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (Aiven cloud) |
| `LIVEKIT_URL` | LiveKit server address |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit auth |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS Bedrock for Replay AI analysis |
| `JWT_SECRET` | Auth token signing |

**Common issue:** `EADDRINUSE` on port 4000 — kill the stale process first:
```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN -t | xargs kill -9
```

---

### 3. Frontend (React / Vite)

**What it does:** Web UI for Replay, Elevate, History, and all user-facing features.

**Start:**
```bash
npm run dev:web
```

**Runs on:** http://localhost:5173

**Config:** No `.env` file needed for local dev (defaults to `http://localhost:4000` for API).

---

### 4. LiveKit Agent Worker (Python)

**What it does:** AI voice assistant that joins LiveKit rooms for the Elevate module. Uses AWS Bedrock/NovaSonic for speech-to-speech AI conversation.

**Required for:** Elevate module only. Replay works without this.

**First-time setup:**
```bash
cd apps/agent
python3.12 -m venv .venv312
source .venv312/bin/activate
pip install -r requirements.txt
```

**Start:**
```bash
cd apps/agent
source .venv312/bin/activate
python main.py dev
```

Or from the project root:
```bash
cd apps/agent && bash run_agent.sh
```

**Config:** `apps/agent/.env`

**Key env vars:**
| Variable | Purpose |
|---|---|
| `LIVEKIT_URL` | Must match the server's LiveKit URL |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Must match LiveKit server config |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS Bedrock for voice AI |
| `SERVER_URL` | Backend API for saving metrics/transcripts |

**How to verify it's running:** Look for this log line:
```
INFO  livekit.agents  registered worker  {"id": "AW_...", "url": "ws://localhost:7880"}
```

---

## Quick Start (All Services)

Open **4 terminal tabs** and run:

```bash
# Terminal 1 — LiveKit Server (skip if Docker container already running)
docker start livekit-server

# Terminal 2 — Backend
npm run dev:server

# Terminal 3 — Frontend
npm run dev:web

# Terminal 4 — Agent Worker
cd apps/agent && bash run_agent.sh
```

Or start backend + frontend together (2 terminals):
```bash
# Terminal 1 — Backend + Frontend
npm run dev

# Terminal 2 — Agent Worker
cd apps/agent && bash run_agent.sh
```

## Feature Dependency Matrix

| Feature | Backend | Frontend | LiveKit Server | Agent Worker |
|---|---|---|---|---|
| **Login / Auth** | Required | Required | - | - |
| **Replay** (transcript analysis) | Required | Required | - | - |
| **Elevate** (live AI coaching) | Required | Required | Required | Required |
| **History / My Sessions** | Required | Required | - | - |

## Troubleshooting

### Backend won't start — EADDRINUSE
```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN -t | xargs kill -9
npm run dev:server
```

### Elevate — "Waiting for assistant..." forever
The agent worker is not running. Start it:
```bash
cd apps/agent && bash run_agent.sh
```

### Elevate — Room connects but agent doesn't join
1. Check LiveKit server is running: `docker ps | grep livekit`
2. Check agent is registered: look for `registered worker` in agent terminal
3. Verify API keys match across all three configs:
   - `infra/livekit/livekit.yaml`
   - `apps/server/.env`
   - `apps/agent/.env`

### Database issues
The PostgreSQL database is hosted on Aiven cloud. Ensure you have internet connectivity. Connection string is in `apps/server/.env`.

To push schema changes:
```bash
cd apps/server && npx prisma db push
```

### Frontend port conflict
If port 5173 is taken, Vite auto-assigns the next available port (5174, etc.). Check the terminal output for the actual URL.
