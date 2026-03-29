# Generic Backlog

## 2026-03-25

### 1) Remove Replay Context Fields (Deferred)

#### Goal
Remove these Replay context fields end-to-end for a simplified workflow:
- `meetingType`
- `userRole`
- `focusAreas`
- `meetingGoal`

Keep only:
- `sessionName`
- `participantName` (required)
- `meetingDate` (auto-detect from VTT metadata when possible; otherwise required before analysis)

#### Why deferred
These fields are still referenced in:
- DB schema (`ReplaySession`)
- API contracts
- Bedrock prompt shaping (`apps/server/src/lib/aws-bedrock.ts`)
- UI/history surfaces

A safe removal needs coordinated backend + frontend + DB migration.

#### Planned implementation (later)
1. **Backend prompt updates**
   - Update `apps/server/src/lib/aws-bedrock.ts` to remove prompt dependencies on:
     - meeting type criteria map
     - user role line
     - focus areas line
     - meeting goal line
   - Replace with neutral/general coaching criteria.
2. **API contract cleanup**
   - Remove properties from create-session payload, replay response shapes, and related TypeScript interfaces.
3. **DB migration**
   - Prisma migration to drop columns from `ReplaySession`:
     - `meetingType`
     - `userRole`
     - `focusAreas`
     - `meetingGoal`
4. **Frontend cleanup**
   - Remove display of these fields from replay context, history, and results views.
5. **Regression checks**
   - Create session -> upload -> process -> results
   - Reprocess flow with cache
   - Participant fallback to dominant speaker
   - Progress Pulse chronology by `meetingDate`

#### Acceptance criteria
- Replay works without these 4 fields anywhere in UI/API/DB.
- No TypeScript errors, no Prisma runtime errors.
- Bedrock analysis quality remains acceptable with generalized prompt context.

#### Risks / notes
- Removing context can reduce prompt specificity for some scenarios.
- If needed later, reintroduce as optional metadata (not required DB columns).

---

### 2) Remove DEV-Only AWS Transcribe Streaming Path Before Production

#### Goal
Remove all development-only transcription code paths and revert to production-safe AWS Transcribe flow.

#### Scope
- Remove `apps/server/src/lib/aws-transcribe-streaming.ts` and its usage.
- Remove DEV-only branching in `apps/server/src/routes/replay.ts` for streaming.
- Ensure only production path remains:
  - upload audio to S3
  - run batch AWS Transcribe
  - fetch result
- Clean up DEV-only comments/banners and related fallback behavior.

#### Validation
- Replay processing works end-to-end in prod mode with S3 + batch Transcribe.
- No references to `aws_transcribe_streaming` remain in code, responses, or metrics source labels.
- Typecheck/lints pass and replay regressions are clean.

---

## 2026-03-29 — Review Backlog

### 3) Security: Authenticate LiveKit Endpoints

**Priority:** High

- `/livekit/token` and `/livekit/dispatch` are unauthenticated — any client can request room tokens.
- Add JWT middleware to these routes, requiring a valid user session before creating rooms.

### 4) Security: Fix IDOR Vulnerabilities Across Routes

**Priority:** High

- `sessions.ts` — `listSessions` returns all sessions without userId filter; `getSession`, `endSession`, `deleteSession`, `saveTranscript`, `saveRecording` don't verify ownership.
- `replay.ts` — upload, process, status, results, download, delete routes operate by ID without userId ownership check.
- `metrics.ts` — `getUserSessionsMetrics` uses userId from URL param without verifying it matches the authenticated user.
- `progress-pulse.ts` — `recordProgressPulse` and `skipProgressPulse` don't verify sessionId belongs to the user.

**Fix:** Add `session.userId === req.user.userId` guard to all data-mutating and data-reading routes.

### 5) Security: Strengthen Internal Agent Token

**Priority:** Medium

- `INTERNAL_AGENT_TOKEN` defaults to `dev-internal-agent-token` — ensure this is overridden with a strong secret in production `.env`.
- Consider rotating to a short-lived signed JWT for agent-to-server calls.

### 6) Security: Authenticate WebSocket Subscriptions

**Priority:** Medium

- The WebSocket server subscription logic in `index.ts` does not validate JWT — any client can subscribe to session updates if the sessionId is known.

### 7) Code Quality: Add try/catch to aws-bedrock.ts

**Priority:** Medium

- `client.send(command)` and `response.body` decode/parse in `analyzeTranscript` lack error handling.
- Wrap in try/catch and return a meaningful error response instead of unhandled crash.

### 8) Code Quality: Remove Dead Code

**Priority:** Low

- `skillScores.ts` — `normalizeVocabSophistication` and `normalizeTopicDrift` are imported but never used.
- `text_signals.py` — `duration_sec` passed to `_extract_question_handling` but unused.
- `main.py` — `usage_metrics` dict is dead state; `_debug_log` is enabled by default (add env guard).
- `App.tsx` — `/settings` route exists but the page is a stub (`<div>Settings</div>`).

### 9) Code Quality: Harden Python Agent Error Handling

**Priority:** Medium

- `signal_api.py` — `json.loads(raw)` in `_read_body` has no try/except, crashes on invalid JSON.
- `main.py` — `/tmp/spashtai_agent_debug.log` grows without bound (add log rotation or disable in production).
- `main.py` — `load_dotenv()` runs late; move before any env-dependent imports.

### 10) Infrastructure: Add Tests

**Priority:** High (before production)

- Zero test coverage currently across server, web, and agent.
- Start with:
  - Server: unit tests for normalization, skill scoring, weighted score formula.
  - Agent: unit tests for exercise template generation, signal extraction.
  - Frontend: component tests for ProgressPulseCard, ReplayResults rendering.

### 11) Infrastructure: CI/CD Pipeline

**Priority:** Medium

- No GitHub Actions or CI pipeline exists.
- Add workflows for: lint, typecheck, test, build verification on PRs.

### 12) Infrastructure: Caching Layer

**Priority:** Low

- No Redis/in-memory cache for frequently accessed data (user sessions list, Progress Pulse summary).
- Consider adding caching for the Progress Pulse summary endpoint and replay results.

### 13) Product: Meeting Summary Section

**Priority:** Medium

- Add a "Meeting Summary" section to Replay Results showing: topics discussed, key outcomes, open questions.
- Requires updating the Bedrock prompt to extract summary data.

### 14) Product: Benchmarking / Percentile Ranking

**Priority:** Low (requires user base)

- Show users how they compare against anonymized aggregates (e.g., "Clarity: Top 10%").
- Requires enough user data to compute meaningful percentiles.

### 15) Product: Settings Page Stub

**Priority:** Low

- `/settings` route exists but only renders a stub. Either implement (theme, notification prefs, profile) or remove from navigation.

### 16) Product: Onboarding Flow for New Users

**Priority:** Medium

- No onboarding tour or first-time guidance. Students and job seekers need help understanding the Replay → Elevate → Progress Pulse loop.

### 17) Product: Elevate Post-Session Score Comparison

**Priority:** Medium

- After an Elevate practice session ends, show a comparison card: "Your conciseness score in this practice: 7.2 (vs 6.0 in your last meeting — improving!)".

### 18) S3 Bucket Configuration for Production Egress

**Priority:** High (before production)

- `RoomCompositeEgressRecorder` and `EgressRecorder` use placeholder `s3://your-bucket/` paths. Replace with actual S3 bucket name and configure IAM permissions.
