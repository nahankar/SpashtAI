# SpashtAI — Logging & Observability Changes

> **Created:** 2026-07-01 · Summary of all logging/observability work delivered.
> **Operational guide:** see [OBSERVABILITY.md](./OBSERVABILITY.md) for how to read/operate the logs.
> **Design principle:** Mac-first — logs live on EC2 (PM2 files) + S3 (browser logs); the Mac is a viewer. No Grafana/Loki/Prometheus on the box. Every change is additive and fail-safe (logging never breaks a request or the live agent).

---

## 1. Three log streams + one correlation key

| Stream | Source | Format | Lands in |
|--------|--------|--------|----------|
| **API** | Express via `pino-http` | JSON, 1 line/request | PM2 → `/opt/spashtai/logs/spashtai-api-*.log` |
| **Agent** | Python LiveKit worker (`main.py start`) | JSON to stdout | PM2 → `/opt/spashtai/logs/spashtai-agent-*.log` |
| **Browser** | `remoteLogger` → `POST /api/client-logs` | JSONL, 1 object/batch | `s3://spashtai-logs/browser/YYYY/MM/DD/{sessionId}/…` |

Correlation key across all three: **`sessionId`** (browser sends `x-conversation-id`; API stamps it; agent binds it). API requests also carry a `requestId` (echoed via the `x-request-id` response header).

---

## 2. Files added

| File | Purpose |
|------|---------|
| [apps/server/src/lib/logger.ts](../apps/server/src/lib/logger.ts) | Central pino logger (JSON to stdout) with secret **redaction**; `reqLog(req)` helper for request-correlated logs |
| [apps/server/src/routes/clientLogs.ts](../apps/server/src/routes/clientLogs.ts) | `POST /api/client-logs` → per-batch JSONL to S3; auth + dedicated rate limiter; fail-safe + flag-gated |
| [apps/web/src/lib/remoteLogger.ts](../apps/web/src/lib/remoteLogger.ts) | Browser logger: captures `window.onerror`/`unhandledrejection`, forwards `console.error/warn`, ships errors/warns/events; `logEvent()` API |
| [apps/agent/log_context.py](../apps/agent/log_context.py) | `contextvars`-backed logging filter that binds `session_id`/`room` to every agent log line |
| [infra/ec2/logrotate/spashtai](../infra/ec2/logrotate/spashtai) | logrotate rule for the agent `/tmp/spashtai_agent_debug.log` |
| [infra/ec2/cleanup-egress.sh](../infra/ec2/cleanup-egress.sh) | Purge local egress media >6h old (already on S3) |
| [infra/ec2/monitor.sh](../infra/ec2/monitor.sh) | Disk %, `/ready`, and core-port check → WARN line + optional webhook alert |
| [docs/OBSERVABILITY.md](./OBSERVABILITY.md) | Operational guide (streams, correlation, retention, Mac workflow, enablement) |

## 3. Files modified

| File | Change |
|------|--------|
| [apps/server/src/index.ts](../apps/server/src/index.ts) | `pino-http` (genReqId + `x-request-id` echo, `customProps` userId/sessionId, `/health` ignore, URL `access_token` redaction serializer); `/api/client-logs` route; **`/ready`** DB readiness probe; **central error handler** |
| [apps/server/src/lib/aws-bedrock.ts](../apps/server/src/lib/aws-bedrock.ts) | LLM stream: `bedrock.invoke` log (model, prompt/completion tokens, latency, parseOk) |
| [apps/server/src/routes/auth.ts](../apps/server/src/routes/auth.ts) | `auth.login_failed`/`login_succeeded`/`login_error` events; **reset-token console log gated to dev**; `console.*`→structured |
| [apps/server/src/routes/sessions.ts](../apps/server/src/routes/sessions.ts) | `elevate.session_created`/`session_ended` events; `console.*`→structured |
| [apps/server/src/routes/analytics.ts](../apps/server/src/routes/analytics.ts) | `analyze.succeeded`/`analyze.failed` events; `console.*`→structured |
| [apps/server/src/routes/livekit.ts](../apps/server/src/routes/livekit.ts) | `livekit.token_issued` event; `console.*`→structured |
| [apps/server/src/routes/replay.ts](../apps/server/src/routes/replay.ts) | `replay.process_started`/`process_completed`/`process_failed` events; `console.*`→structured |
| [apps/server/src/routes/conversations.ts](../apps/server/src/routes/conversations.ts) | Structured error log; **removed `req.body` (transcript) from logs**; `console.*`→structured |
| [apps/agent/metrics_collector.py](../apps/agent/metrics_collector.py) | Voice stream: STT/EOU/LLM/TTS stage timings + turn latency as structured `extra` fields (`step`, `*_ms`, `speech_id`) |
| [apps/agent/main.py](../apps/agent/main.py) | Guarded import + `install_session_log_context()` / `bind_log_context()` in entrypoint |
| [apps/web/src/lib/api-client.ts](../apps/web/src/lib/api-client.ts) | `getCorrelationHeaders()` → `x-request-id` + `x-conversation-id` on every API call |
| [apps/web/src/main.tsx](../apps/web/src/main.tsx) | `initRemoteLogger()` before render |
| [apps/web/vite.config.ts](../apps/web/vite.config.ts) | `__APP_VERSION__` define (release stamp in browser logs) |
| [apps/web/src/pages/Elevate.tsx](../apps/web/src/pages/Elevate.tsx) | `elevate.session_join`/`session_join_failed`/`session_leave` events |
| [infra/ec2/bootstrap.sh](../infra/ec2/bootstrap.sh) | Installs `pm2-logrotate` + the logrotate rule on fresh instances |
| [infra/postgres](../infra/postgres/docker-compose.yml) / [livekit](../infra/livekit/docker-compose.yml) / [gentle](../infra/gentle/docker-compose.yml) compose | Docker `json-file` log caps (`max-size 10m`, `max-file 3`) |
| env templates (`apps/server/env.example`, `infra/ec2/env/server.env.example`, `apps/web/.env.example`) | `LOG_LEVEL`, `CLIENT_LOGS_ENABLED`, `CLIENT_LOGS_S3_BUCKET`, `VITE_CLIENT_LOGS_ENABLED` |

## 4. Dependencies added
- Server: **`pino`**, **`pino-http`** (only new deps; pulled by `npm ci` on deploy). No new Python or web deps. Browser→S3 uses the existing `@aws-sdk/client-s3`.

## 5. Named events (for `jq 'select(.event=="…")'`)
`auth.login_failed`, `auth.login_succeeded`, `auth.login_error`, `auth.reset_email_failed`,
`elevate.session_created`, `elevate.session_ended`, `elevate.session_join`, `elevate.session_join_failed`, `elevate.session_leave`,
`livekit.token_issued`, `analyze.succeeded`, `analyze.failed`,
`replay.process_started`, `replay.process_completed`, `replay.process_failed`,
`bedrock.invoke` (LLM cost/latency). Agent Voice stream: `metric=stage_timing` (`step` ∈ stt|eou|llm|tts) and `metric=turn_latency`.

## 6. Security / privacy properties
- **Redaction** at the logger: `authorization`, `cookie`, `x-internal-agent-token`, `set-cookie`, and `access_token` in both query and **URL** (custom req serializer).
- **Browser logger** strips JWT / `Bearer …` / `access_token=…` from messages client-side.
- **No transcripts/prompts/tokens** are logged. The `/api/client-logs` endpoint is `requireAuth` + rate-limited and no-ops unless `CLIENT_LOGS_ENABLED=true`.

## 7. Bugs found & fixed during the self-review (architect pass)
| Severity | Bug | Fix |
|----------|-----|-----|
| High | `/ready` leaked an `unhandledRejection` on every success (timeout promise rejected after the race settled) | Clear the timer in `finally`; swallow the losing query's late rejection |
| High | `access_token` JWT logged **unredacted in `req.url`** (redaction only covered query/headers) | Added a pino-http req serializer that redacts `access_token` in the URL |
| Medium | Browser-log truncation sliced the serialized JSON string → **invalid JSONL** | Emit a valid truncated object instead |
| Medium | `keepalive` fetch body capped at 64KB but limit was 90KB → large unload flushes silently dropped | Lowered cap to 55KB + drop-oldest-to-fit loop |

All verified: server `tsc -b` clean, agent `py_compile` + runtime tests, web `vite build` clean, and targeted runtime tests (URL redaction, `/ready`, JSONL validity).

## 8. What's NOT done (logging backlog)
- Agent's 77 raw `print()`s (separate from the structured stage timings) remain unstructured.
- WebSocket conversation-broadcast handlers still use bare `console.*` (outside pino-http).
- S3 lifecycle rules for `browser/` (manual AWS step), nightly PM2-log archive to S3, remaining info-level `console.log` migration.
- CloudWatch alarms / external uptime monitor (deferred; `monitor.sh` is the stopgap).

## 9. To activate in production
See [OBSERVABILITY.md](./OBSERVABILITY.md) §"Enabling browser logs" and §"Retention". In brief: `npm ci` (pulls pino) via deploy → `pm2 install pm2-logrotate` → copy the logrotate file → recreate Docker containers (log caps) → set env (`LOG_LEVEL`, and `CLIENT_LOGS_ENABLED=true` only after the `spashtai-logs` bucket + IAM `s3:PutObject` exist) → add the `monitor.sh`/`cleanup-egress.sh` cron lines.
