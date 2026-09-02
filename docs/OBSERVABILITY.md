# SpashtAI — Observability (Mac-first)

> Logs live on EC2 (PM2 files) and in S3 (browser logs). Your Mac is a **viewer**,
> not a collector — nothing about production logging depends on the laptop being
> online. No Grafana/Loki/Prometheus runs on the t3.large.

## Log streams

| Stream | Source | Format | Where it lands | Read from Mac |
|--------|--------|--------|----------------|---------------|
| **API** | Express via `pino-http` ([apps/server/src/lib/logger.ts](../apps/server/src/lib/logger.ts)) | JSON, one line per request | PM2 → `/opt/spashtai/logs/spashtai-api-{out,error}.log` | `ssh … tail -F` / `rsync` |
| **Agent** | Python LiveKit worker (`main.py start` → livekit-agents JSON) | JSON to stdout | PM2 → `/opt/spashtai/logs/spashtai-agent-{out,error}.log` | `ssh … tail -F` / `rsync` |
| **Browser** | `remoteLogger.ts` → `POST /api/client-logs` | JSONL, one object per batch | `s3://spashtai-logs/browser/YYYY/MM/DD/{sessionId}/…` | `aws s3` / Cyberduck |

The legacy `console.*` calls (~220 in the server) are untouched and still land in
the same PM2 files — the pino line is *added* alongside them, not a replacement.

## Correlation

- Every API request gets a `requestId` (honors an inbound `x-request-id`, else a
  UUID) and echoes it back in the `x-request-id` response header.
- Send `x-conversation-id: <sessionId>` from the client and it appears as
  `sessionId` on the API log line. For a live Elevate session the join key across
  API + agent + browser logs is the **sessionId** (`session_…`), not the
  per-request id (requestId only spans one HTTP call).

```bash
# All API logs for one request id
ssh ubuntu@<ec2> 'grep <request-id> /opt/spashtai/logs/spashtai-api-out.log' | jq .
# One session across API + agent
ssh ubuntu@<ec2> 'grep session_1719789123_abc /opt/spashtai/logs/spashtai-*.log' | jq -c .
```

## Redaction (enforced in code)

`logger.ts` redacts `authorization`, `cookie`, `x-internal-agent-token`,
`set-cookie`, and the `access_token` query param at the logger level, so request
logging cannot leak a bearer/internal token. The browser logger additionally
strips JWTs / `Bearer …` / `access_token=…` from messages before they leave the
device. **Never** add prompt text, transcripts, or tokens to a log call.

## Retention / disk safety

| What | Mechanism | Default |
|------|-----------|---------|
| PM2 API/agent logs | `pm2-logrotate` (installed by [bootstrap.sh](../infra/ec2/bootstrap.sh)) | rotate at 50M, keep 14, gzip |
| Agent `/tmp/spashtai_agent_debug.log` | logrotate ([infra/ec2/logrotate/spashtai](../infra/ec2/logrotate/spashtai)) | daily, keep 7, gzip |
| Browser logs in S3 | **S3 lifecycle rule (you add)** | suggest expire `browser/` after 30d |

On an existing instance bootstrapped before this was added:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
sudo cp infra/ec2/logrotate/spashtai /etc/logrotate.d/spashtai
```

Also capped now:

- **Docker container logs** — every service in `infra/{postgres,livekit,gentle}/docker-compose.yml` sets `json-file` `max-size: 10m` / `max-file: 3`. Takes effect on the next `docker compose up -d` (container recreate).
- **Local egress media** — [infra/ec2/cleanup-egress.sh](../infra/ec2/cleanup-egress.sh) purges `apps/agent/audio_storage/*.{mp4,ogg,webm}` older than 6h (already uploaded to S3). Wire it to cron:

  ```bash
  0 * * * * /opt/spashtai/infra/ec2/cleanup-egress.sh >> /opt/spashtai/logs/egress-cleanup.log 2>&1
  ```

## Alerting

Logs without a watcher only help post-mortem. [infra/ec2/monitor.sh](../infra/ec2/monitor.sh)
is a dependency-free check (root disk %, the DB-backed `/ready` probe, and the
Postgres/LiveKit/Gentle ports). It logs a WARN line and, if `ALERT_WEBHOOK_URL`
is set, POSTs a one-line alert to Slack/Discord/any webhook. Run from cron:

```bash
*/5 * * * * ALERT_WEBHOOK_URL=https://hooks.slack.com/… /opt/spashtai/infra/ec2/monitor.sh >> /opt/spashtai/logs/monitor.log 2>&1
```

For always-on paging independent of the box, add a **CloudWatch alarm** on disk
(install the CloudWatch agent for the `disk_used_percent` metric) and an external
uptime check hitting `https://api.spasht.ai/ready`. The script is the zero-setup
stopgap; CloudWatch is the durable version.

> Liveness vs readiness: `/health` stays a cheap static `{status:"ok"}` (process
> up); `/ready` runs `SELECT 1` against Postgres (2s timeout) and returns 503 if
> the DB is unreachable — point monitors/alarms at `/ready`.

## Enabling browser logs in production

1. Create bucket **`spashtai-logs`** (same region; **Block Public Access on**).
2. Grant the EC2 instance role `s3:PutObject` on `arn:aws:s3:::spashtai-logs/browser/*`.
3. `apps/server/.env`: `CLIENT_LOGS_ENABLED=true` (+ `CLIENT_LOGS_S3_BUCKET=spashtai-logs`), then `pm2 restart spashtai-api`.
4. Web ships browser logs in production builds by default (`VITE_CLIENT_LOGS_ENABLED=false` to opt out).
5. Add the S3 lifecycle rule expiring `browser/` after ~30 days.

It is **safe to leave disabled**: the endpoint is auth-gated + rate-limited and
no-ops (accepts and drops) until `CLIENT_LOGS_ENABLED=true`, and the browser
logger never throws into the app.

## Mac quick reference

```bash
# Live tails
ssh ubuntu@<ec2> "tail -F /opt/spashtai/logs/spashtai-api-out.log"   | jq -c 'select(.level>=50)'
ssh ubuntu@<ec2> "tail -F /opt/spashtai/logs/spashtai-agent-out.log"
ssh ubuntu@<ec2> "pm2 logs"

# Pull logs locally for jq/ripgrep
rsync -avz ubuntu@<ec2>:/opt/spashtai/logs/ ./local-logs/

# Browser logs from S3
aws s3 ls s3://spashtai-logs/browser/$(date -u +%Y/%m/%d)/
aws s3 cp --recursive s3://spashtai-logs/browser/$(date -u +%Y/%m/%d)/ ./browser-logs/
cat ./browser-logs/**/*.jsonl | jq -c 'select(.level=="error")'
```

## When to graduate off Mac-first

Add a managed service (CloudWatch alarms, Grafana Cloud) when you need **always-on
alerting** — e.g. paging on 5xx spikes or disk pressure while you're away. That is
the trigger to centralize, not dashboards-for-their-own-sake. See the resilience
review for the backup/alerting gaps that matter before scale.
```
