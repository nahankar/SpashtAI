# SpashtAI — AI Communication Coach

SpashtAI is a full-stack AI-powered communication coaching platform that helps professionals, job seekers, and students improve their speaking skills through real meeting analysis and live AI practice sessions.

## Core Modules

| Module | Purpose |
|---|---|
| **Replay** | Upload meeting recordings (VTT/audio) for AI-powered transcript analysis, skill scoring, and coaching insights |
| **Elevate** | Live AI voice coaching sessions with structured exercises targeting specific communication skills |
| **Progress Pulse** | Longitudinal skill tracking across Replay and Elevate sessions with trend analysis |

## 8-Skill Communication Model

Every session is scored across six core skills:

- **Clarity** — how clearly ideas are communicated
- **Confidence** — assertiveness, hedging reduction
- **Engagement** — question-asking, active participation
- **Structure** — logical organization of ideas
- **Conciseness** — delivering points without unnecessary words
- **Pacing** — speaking speed and rhythm control

## Architecture

```
┌──────────────────────┐     ┌──────────────────────────┐
│  React Frontend      │     │  LiveKit Server (Docker)  │
│  (Vite + Tailwind)   │────▶│  Real-time audio/video    │
│  localhost:5173       │     │  localhost:7880            │
└──────────┬───────────┘     └──────────┬───────────────┘
           │ REST API                   │ Agent Worker
           ▼                            ▼
┌──────────────────────┐     ┌──────────────────────────┐
│  Express Server      │     │  Python LiveKit Agent     │
│  (Node.js + Prisma)  │     │  (AWS Bedrock/NovaSonic)  │
│  localhost:4000       │     │  Structured exercises     │
└──────────┬───────────┘     └──────────────────────────┘
           │
           ▼
┌──────────────────────┐
│  PostgreSQL (Aiven)  │
└──────────────────────┘
```

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, ShadCN UI, Recharts
- **Backend:** Node.js, Express, Prisma ORM, TypeScript
- **AI Agent:** Python, LiveKit Agents SDK, AWS Bedrock (Claude/Nova)
- **Real-time:** LiveKit (WebRTC)
- **Cloud:** AWS (Bedrock, Transcribe, S3), Aiven PostgreSQL

## Project Structure

```
apps/
  web/          React frontend (Vite)
  server/       Express API server + Prisma
  agent/        Python LiveKit voice agent
docs/           Architecture and setup documentation
infra/          LiveKit server config
```

## Quick Start

See [docs/LOCAL-DEVELOPMENT-SETUP.md](docs/LOCAL-DEVELOPMENT-SETUP.md) for detailed setup instructions.

```bash
# Install dependencies
npm install

# Start backend + frontend
npm run dev

# Start LiveKit server (Docker)
docker start livekit-server

# Start AI agent (separate terminal)
cd apps/agent && bash run_agent.sh
```

## Key Features

- **Annotated Transcripts** — AI-labeled segments (clarification, strong statement, action item, suggestion, conversation control)
- **Weighted Communication Score** — deterministic formula with low-skill penalty
- **Personalized Coaching** — Elevate sessions use Replay data, skill trends, and past practice context
- **Exercise Templates** — 8 structured mini-exercises mapped to each skill area
- **Practice Preview** — see exercise structure and predicted score improvement before starting
- **Trend Stability** — rolling average baselines with ±0.5 stability bands prevent noisy score swings
- **Long-term Progress** — track improvement from your first session
- **Export** — JSON and PDF session reports

## License

Private / All rights reserved.
