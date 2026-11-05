# Generic Backlog

> **North Star:** Product architecture, utterance model, and phased roadmap live in [NORTHSTAR.md](./NORTHSTAR.md).  
> Elevate voice reliability and utterance persistence are **P0 / P1** there—backlog items below should reference those phases when touching live coaching or metrics storage.

## 2026-11-05 — Current focus and parked workspace development

**Owner priority:** focus next on adaptive Interview questions. Workspace Prepare and AI Coach are parked for later development; this entry does not authorize implementation, feature enablement, or deployment.

### Current focus — Adaptive Interview questions (Phase 3.3c)

- Current assessment and proposed bank-first implementation: [Adaptive next-question plan](prepare/INTERVIEWS-ADAPTIVE-NEXT-PLAN.md) (baseline `810a65b`, 5 November 2026).
- Start from [the conversational/adaptive design](prepare/INTERVIEWS-PHASE-3.3.md) and [the 3.3b follow-up](prepare/INTERVIEWS-PHASE-3.3b-FOLLOWUP.md). Reconcile these documents with current code before writing a new implementation plan.
- Assess what exists versus what remains for choosing the next question from the learner's answer: follow-up, easier/harder question, or topic change, using reviewed bank questions first.
- The existing `interview_adaptive` capability includes learner evaluation; its presence does not prove adaptive next-question selection is implemented or enabled. Keep grading, automatic conversation progression, and adaptive selection distinct in the assessment.
- Preserve selected track/experience constraints, transcript integrity, question provenance, workspace isolation, and time/attempt bounds. Technical feedback and model answers remain hidden until the practice ends; the learner's transcript stays available under Show conversation.
- Before completion, validate affected manual/conversation paths and real multi-turn audio with the existing automated voice candidate, and report the exact application/tool revisions and evidence. A detailed implementation scope is the next deliverable, not a production readiness flip.

### Parked — Prepare in organization workspaces

**Status:** deferred by the owner on 2026-11-05; not a prerequisite for adaptive Interview work.

- Reuse the existing workspace-owned Preparation data and database isolation. Complete organization API guards, `/w/:slug/prepare/*` navigation and deep links, and tenant/member feature permissions.
- Keep journeys, stages, questions, linked Elevate/Replay practices, recordings, recovery and deletion inside the selected workspace. Stamp deletion jobs with workspace ownership.
- Attribute activity to Prepare rather than Interviews. Extend Owner/Admin read-only review for organization practices explicitly; current review policies exclude Prepare-linked activity.
- Prove isolation with the same learner in two organizations plus Personal, including direct-ID/media access, suspension, deletion, and automated voice validation of journey-launched practice.
- Prepare can ship independently of Coach. Dedicated databases, billing, SSO, organization templates and exports are outside the initial scope.
- Detailed milestones and provisional estimates: [Prepare workspace plan](PREPARE-WORKSPACE-PLAN.md). Reassess against the then-current code before scheduling; the estimate is not a delivery commitment.

### Parked — AI Coach in organization workspaces

**Status:** deferred by the owner on 2026-11-05; not a prerequisite for adaptive Interview work.

- Reuse existing Coach chat and workspace isolation; complete workspace pages/navigation, refresh/recovery and links.
- Build Coach context only from the selected workspace's conversations, Pulse, Elevate/Replay results and eligible Prepare journeys. Personal and other organization history must never enter the context or recommendations.
- Recommendations must respect current workspace/member entitlements and keep practice launches in that workspace. If Prepare is not ready/enabled, omit Prepare recommendations and context.
- Define Owner/Admin review of organization Coach conversations explicitly before exposing them; existing session-review support must not be assumed to cover Coach chat.
- Test two organizations plus Personal, known-ID access, role/suspension changes, context isolation and workspace switching. Run automated real-audio scenarios for any affected voice launches.
- Produce a focused scope and estimate when resumed. Do not bundle unrelated infrastructure or commercial features.

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

### 19) Refactor: Restructure Routes into Subdirectories

**Priority:** Low (when route count exceeds ~15 files)

- Current flat `routes/` folder has 8-9 files — still manageable.
- When it grows, reorganize into `routes/replay/`, `routes/elevate/`, `routes/analytics/`, `routes/admin/`.
- Update all imports in `index.ts`.

### 20) Refactor: Extract ReplayService from replay.ts

**Priority:** Medium (before adding second replay entry point)

- `replay.ts` currently handles upload, transcription, parsing, signal extraction, scoring, insight generation, and DB writes.
- Extract into a `ReplayService` or `ReplayPipeline` class that the route calls.
- Makes logic reusable for future webhook or API-only replay triggers.

### 21) Infrastructure: Async Replay Processing Queue

**Priority:** Low (when concurrent users cause blocking)

- Replay processing is synchronous (~30-60s). Fine for single-user, blocks at scale.
- Move to background worker with job queue (e.g., BullMQ + Redis).
- Route returns job ID immediately, frontend polls for status (already has status UI).

---

## Categorized Backlog (Rolling)

### Security & Access Control

#### 22) Security: Scoped Internal JWT for Agent-to-Server Calls

**Priority:** High

- Replace broad shared `x-internal-agent-token` usage with short-lived signed internal JWTs.
- Include narrow claims such as:
  - `sessionId`
  - allowed route/action scope (e.g. `metrics:write`, `transcript:write`, `audio:write`)
  - `exp` (very short expiry)
  - optional request nonce/jti for replay protection
- Enforce claim checks at endpoint level to reduce blast radius if a token leaks.
- Keep shared-secret fallback only for explicit local development paths.

**Why this belongs here**
- This is the concrete follow-up to item #5 ("Strengthen Internal Agent Token") and addresses token-leak blast-radius concerns.

### Product & UX

- Existing product work items remain in #13, #14, #15, #16, #17.

### Infrastructure & Reliability

- Existing infra work items remain in #10, #11, #12, #18, #21.

### Refactor & Maintainability

- Existing refactor/code-quality work items remain in #7, #8, #9, #19, #20.
