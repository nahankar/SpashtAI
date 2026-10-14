# AI Analytics Explorer — Cube Core 1.8.5

Self-hosted [Cube Core](https://docs.cube.dev/) for the SpashtAI AI Analytics Explorer. It answers aggregate questions over learner feature use, demographics, and Elevate/Replay language medians. The connection is the existing PostgreSQL `DATABASE_URL`, and the session is read-only.

This model is tied to the Prisma schema. When `apps/server/prisma/schema.prisma` or the canonical predicates in `apps/server/src/analytics/adminProductAnalytics.ts`, `pulseEligibility.ts`, or `productEvents.ts` change, update `model/` in the same change. The feature booleans and NLP filters are those predicates, not `FeatureUsage` events.

## Run

From this directory:

```bash
cp .env.example .env
# Edit DATABASE_URL and CUBEJS_API_SECRET.
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:4002/livez
curl -fsS http://127.0.0.1:4002/readyz
```

The image is `cubejs/cube:v1.8.5`. The container entrypoint is `cubejs server`. Container port 4000 is bound to host `127.0.0.1:4002` only, avoiding the SpashtAI API on port 4000. Put a TLS reverse proxy in front before any other host can reach it. `localhost` and `127.0.0.1` in `DATABASE_URL` are rewritten to `host.docker.internal` so a database on the Docker host is reachable. `extra_hosts` maps that name on Linux as well as Docker Desktop.

To include this service in another compose file:

```yaml
include:
  - path: infra/cube/docker-compose.yml
```

Run one replica. The cache and queue driver is `memory`, which is not consistent across processes.

## Configuration

| Variable | Value | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://…` | Existing SpashtAI database. Use a `SELECT`-only role. |
| `CUBEJS_API_SECRET` | long random secret | Verifies HS256 API JWTs. |
| `CUBEJS_DEV_MODE` | `false` | JWT required. Playground is off. |
| `CUBEJS_CACHE_AND_QUEUE_DRIVER` | `memory` | In-process cache and queue until Cube Store is added. |
| `CUBEJS_DB_TYPE` | `postgres` | Source database. |
| `CUBEJS_DB_MAX_POOL` | `4` | Cap concurrent reads against the app database. |
| `CUBEJS_DB_QUERY_TIMEOUT` | `60` | Seconds. Applied as `statement_timeout`. |
| `CUBEJS_TELEMETRY` | `false` | No usage telemetry to Cube. |
| `CUBE_IN_DOCKER` | `true` | Set by compose. Rewrites a localhost database host. |

`cube.js` refuses to start unless dev mode is `false`, the API secret and `DATABASE_URL` are set, the cache driver is `memory`, and `CUBEJS_PG_SQL_PORT` is unset. Scheduled refresh is off because there are no pre-aggregations. Query results are cached in memory for the cube `refresh_key` interval (5 minutes).

`sslmode=require` and `sslmode=no-verify` encrypt without verifying the server certificate. `sslmode=verify-ca` and `sslmode=verify-full` verify it. A `schema` query parameter, when it is a plain identifier, becomes `search_path`.

Do not grant this role write access, and do not point it at a superuser. The driver is constructed with `readOnly: true`, and every session sets `default_transaction_read_only=on`.

## Security

Tokens are HS256 JWTs signed with `CUBEJS_API_SECRET`. Cube's built-in verifier validates the signature and `exp`, then places the payload in the security context. The payload carries `groups` (or a single `group`) with `ai`, `admin`, or both. Any other group is ignored and matches no access policy.

```bash
node -e '
const crypto = require("crypto");
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const header = b64({ alg: "HS256", typ: "JWT" });
const payload = b64({
  groups: ["ai"],
  exp: Math.floor(Date.now() / 1000) + 15 * 60,
});
const signature = crypto.createHmac("sha256", process.env.CUBEJS_API_SECRET)
  .update(header + "." + payload)
  .digest("base64url");
console.log(header + "." + payload + "." + signature);
'
```

`contextToGroups` maps that claim onto Cube access policies. Policies are the only member allow-lists:

- `admin` can query every public member, including `first_name`, `last_name`, and `email`, and can see demographic groups smaller than five learners.
- `ai` can query learner `id` (for paging), age, age band, gender, city, state, the six feature booleans, counts, and the language medians. Identity columns are not on the `ai` allow-list. Per-session sample columns are `public: false`, so neither group can read them.
- A token in both groups is treated as `admin`.

The SQL API is disabled. It stays off unless `CUBEJS_PG_SQL_PORT` is set, and startup fails if that variable is present. REST (`/cubejs-api/v1/load`) and GraphQL (`/cubejs-api/graphql`) both require a JWT. Development mode is off, so there is no Playground and no anonymous token.

Only `User.role = USER` rows are visible. Admin and super-admin accounts are not in the model. Transcripts, answer text, feedback text, phone, pincode, and password fields are not selected.

For the `ai` group, a query that filters or groups by gender, age, age band, city, or state must be an aggregate and must not also select `id` or `user_id`. Cube then keeps only groups whose learner count is at least 5 (`productEvents.ts` `MIN_COHORT`). Language medians use the distinct learners in that language fact (`learner_count`). Headcount queries use `count`. Omitted groups are dropped, so a small city's name does not appear as an empty bucket. Page learners by `id` without demographic members. Aggregate demographics in a separate query.

Do not query `elevate_nlp` and `replay_nlp` together. The two one-to-many facts would fan out and the medians would be wrong.

## Data model

Each boolean is true when its retained canonical condition below is present or when a corresponding `FeatureUsage` row exists. The telemetry supplement prevents older or event-only engagement from being lost while canonical records remain the primary historical source.

| Member | Canonical condition |
| --- | --- |
| `used_replay` | `ReplaySession` with purpose `COMMUNICATION` and no `PreparationRecording`. |
| `used_elevate` | Non-discarded `Session` with purpose `COMMUNICATION` and module `elevate`, excluding `PreparationPractice` and `InterviewRun`. |
| `used_interviews` | `InterviewRun` whose `Session` is not discarded. |
| `used_progress_pulse` | `ProgressPulse` row. Replay source counts only when `metadata.evidenceOrigin` is `replay-server-assessment-v1`. |
| `used_prepare` | Any `Preparation` journey. |
| `used_feedback` | Any `UserFeedback` row. |

Age and age band are calculated at read time with `EXTRACT(YEAR FROM AGE(CURRENT_TIMESTAMP, dateOfBirth))`. Bands are `under_18`, `18_24`, `25_34`, `35_44`, `45_54`, `55_plus`, and `unknown`. Gender values are `MALE`, `FEMALE`, `OTHER`, `PREFER_NOT_TO_SAY`, or null.

Elevate medians read `SessionMetrics` for the same session predicate as `used_elevate`, and only when communication signals, words per minute, or filler count is present. The date window is `started_at` (`Session.startedAt`). Replay medians read `ReplayResult` for the same session predicate as `used_replay`. The date window is `result_created_at` (`ReplayResult.createdAt`).

| Median | Unit |
| --- | --- |
| `median_wpm` | Words per minute. Zero is excluded. |
| `median_filler_rate` | Percent, as stored. |
| `median_hedging_rate` | Percent. Elevate's stored 0–1 rate is multiplied by 100. Replay's stored percent is unchanged. |
| `median_sentence_length` | Words. Zero is excluded. |
| `median_vocab_diversity` | Percent. Elevate's stored 0–1 ratio is multiplied by 100. Replay's stored percent is unchanged. |
| `median_readability` | Flesch score from `communicationSignals.sentenceComplexity.readability`. |
| `median_coherence` | `communicationSignals.topicCoherence.avgSimilarity`. |

Each median is `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY …)`. Null samples are ignored.

Views:

- `learner_explorer` — directory, feature booleans, demographics, `count`
- `elevate_nlp` — those learner attributes plus Elevate medians
- `replay_nlp` — those learner attributes plus Replay medians

Ask for population counts on `learner_explorer`. Ask for language medians on one language view. A language view that also selects `count` is suppressed with the language `learner_count`, so a large demographic with fewer than five measured learners is omitted entirely.

## Query examples

Send `Authorization: Bearer <jwt>` to `http://127.0.0.1:4002/cubejs-api/v1/load`.

Feature use by age band. An `ai` token receives only bands with at least five learners:

```json
{
  "measures": ["learner_explorer.count"],
  "dimensions": ["learner_explorer.used_replay", "learner_explorer.age_band"]
}
```

Elevate medians for a state, last 30 days:

```json
{
  "measures": [
    "elevate_nlp.learner_count",
    "elevate_nlp.median_wpm",
    "elevate_nlp.median_filler_rate",
    "elevate_nlp.median_hedging_rate",
    "elevate_nlp.median_sentence_length",
    "elevate_nlp.median_vocab_diversity",
    "elevate_nlp.median_readability",
    "elevate_nlp.median_coherence"
  ],
  "dimensions": ["elevate_nlp.state"],
  "timeDimensions": [
    { "dimension": "elevate_nlp.started_at", "dateRange": "Last 30 days" }
  ]
}
```

Replay medians for learners who have used Prepare:

```json
{
  "measures": ["replay_nlp.median_wpm", "replay_nlp.learner_count"],
  "filters": [
    { "member": "replay_nlp.used_prepare", "operator": "equals", "values": ["true"] }
  ],
  "timeDimensions": [
    { "dimension": "replay_nlp.result_created_at", "dateRange": "Last 30 days" }
  ]
}
```

Page learner ids. Order by `id` and advance `offset` by `limit`. Boolean filter values are strings.

```json
{
  "dimensions": ["learners.id", "learners.used_elevate", "learners.used_feedback"],
  "order": { "learners.id": "asc" },
  "limit": 50,
  "offset": 0
}
```

Admin identity page. An `ai` token is denied on `first_name`, `last_name`, and `email`:

```json
{
  "dimensions": ["learners.id", "learners.first_name", "learners.last_name", "learners.email"],
  "order": { "learners.id": "asc" },
  "limit": 50,
  "offset": 0
}
```

Total learners, for a page count:

```json
{ "measures": ["learners.count"] }
```

```bash
curl -sS http://127.0.0.1:4002/cubejs-api/v1/load \
  -H "Authorization: Bearer $CUBE_JWT" \
  -H "Content-Type: application/json" \
  -d '{"query":{"measures":["learners.count"]}}'
```

## Later: Cube Store

Memory cache is the initial deployment. Before running more than one API container, replace it with Cube Store and keep this role read-only: use external pre-aggregations stored in Cube Store, not a writable `prod_pre_aggregations` schema in the app database. That change is a later compose revision, not this one.

## Checks

From this directory, with Node and Ruby available:

```bash
node --check cube.js
node --test lib/*.test.js
docker compose config >/dev/null
```

`lib/model.test.js` loads the YAML and checks groups, identity exclusion, canonical SQL fragments, and `percentile_cont` medians. It does not open a database connection.
