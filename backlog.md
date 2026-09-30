# SpashtAI — Engineering Backlog

> **Updated:** 2026-07-01. Cross-cutting issues and observations from architectural review (security, resilience, LLM quality, tests) plus the logging effort. For North-Star phased product work see [docs/GENERIC-BACKLOG.md](docs/GENERIC-BACKLOG.md).

## Reference docs
- 🔐 **[Security & Vulnerability Issues](docs/SECURITY-ISSUES.md)** — full list (C1–C3 critical, H1–H5, M1–M6, L1–L3) with file refs, severity, status, and remediation.
- 🪵 **[Logging & Observability Changes](docs/LOGGING-CHANGES.md)** — everything delivered in the logging effort + the logging backlog.
- 🛠 **[Observability operations](docs/OBSERVABILITY.md)** — how to read/operate the logs from the Mac.

---

## P0 — fix first (high risk, localized)
- [ ] **C1: Unauthenticated LiveKit token minting** — live-session eavesdrop/inject. Add `requireAuth`, derive identity server-side. → [SECURITY-ISSUES#c1](docs/SECURITY-ISSUES.md)
- [ ] **C2/H1/H2: IDOR class** — session metrics, transcripts, coaching insights, skill scores, audio metadata readable/deletable by ID. One ownership middleware fixes most. → [SECURITY-ISSUES](docs/SECURITY-ISSUES.md)
- [ ] **C3: Replay IDOR** — incl. destructive DELETE of other users' recordings. Router-level ownership guard.
- [ ] **LLM P0: Replay stores zero-scores as a "completed" result** on malformed model JSON — `replay.ts` ignores `aiResult.analysisError`. Persist failed/partial instead of fabricated 0/10. *(see LLM Quality below)*
- [ ] **Resilience C1: No Postgres backup/DR** — single EBS volume, zero backups. Add nightly `pg_dump → S3` + EBS snapshots; plan RDS.

## P1 — high
- [ ] **Resilience C2: Agent OOM mid-session loses all turn/metric data** — persist turns incrementally + add `ctx.add_shutdown_callback`.
- [ ] **Resilience C3: Bedrock is an un-fallback-able live dependency** — Nova Sonic is both default and fallback. Add non-Bedrock fallback + backoff.
- [ ] **H3/H4/H5: Token handling** — JWT in `?access_token=` URL (log leak fixed; URL leak remains → short-lived media token), no server-side revocation, `localStorage` storage.
- [ ] **LLM P0/P1: No retry + brittle `{…}` JSON extraction + no output validation** — bounded retry, balanced-brace parse, clamp scores 1–10, delimit untrusted transcript (prompt-injection). `turnSuggestions.ts` is the good template.
- [ ] **Resilience H1/H2: Replay pipeline fragility** — `analyzeTranscript` has no try/catch (throttle = failed replay); in-process fire-and-forget job lost on API restart with no resume. Add retry + durable queue / startup reaper.

## P2 — medium
- [ ] **M1: Admin tier too flat** — any ADMIN can delete users / self-escalate to SUPER_ADMIN. Add `requireSuperAdmin`.
- [ ] **M2: Admin-editable AgentPrompt** drives the live coach with no SUPER_ADMIN lock / audit (prompt-injection surface).
- [ ] **M5/M6: Privacy** — no third-party consent for Replay uploads; erasure doesn't cascade to S3 (biometric voice data persists). GDPR-relevant.
- [ ] **M3/M4: Upload MIME validation + rate-limit coverage** (non-`/api` routes uncovered; auth limiter off outside prod).
- [ ] **Resilience: real `/health` for monitors** — partially done (`/ready` added). Wire monitors/alarms to `/ready`. Add startup ordering (M3), `fetchSignals` timeout (M4), lower Transcribe poll cap (M5).
- [ ] **Tests & CI: none exist.** No test runner, no `.github/workflows`. Start with unit tests on `normalization.ts`/`skillScores.ts`/`speech_patterns.py` (Vitest + pytest) and a CI skeleton (lint + `tsc -b` + tests).

## P3 — quality / hygiene
- [ ] **Migration hygiene** — `deploy.sh` runs `prisma db push` after `migrate deploy`, so migration history isn't authoritative (prod schema can drift). Reconcile.
- [ ] **L1: Fake presigned audio URL** — `audio.ts generateAudioUrl` builds a non-signed URL by string interpolation. Use `getSignedUrl`.
- [ ] **L2: Weak password policy** (min 6) → ≥10–12 + breached-password check.
- [ ] **L3 remainder: response/error detail leakage** — `analytics.ts`/`conversations.ts` still return `error.message` to clients. (Transcript/req.body + reset-token log leaks already fixed.)
- [ ] **Maintainability** — `Elevate.tsx` (~103KB) and `ReplayResults.tsx` (~89KB) are single files; many components bypass `apiClient` (so the central 401 redirect doesn't apply).
- [ ] **LLM P2: determinism + cost** — scoring at temp 0.3/0.4 (re-runs drift); no input-token cap on transcript; audio insight sends whole file; per-process suggestion cache.

## Logging backlog (detail in [LOGGING-CHANGES.md](docs/LOGGING-CHANGES.md))
- [ ] Convert the agent's 77 raw `print()`s to the logger.
- [ ] Structured logging for the WebSocket conversation-broadcast handlers (`index.ts`, outside pino-http).
- [ ] S3 lifecycle rule for `browser/` (manual AWS) + nightly PM2-log archive to S3.
- [ ] CloudWatch disk alarm + external uptime monitor (deferred; `monitor.sh` is the stopgap).
- [ ] Remaining info-level `console.log` → structured migration (Phase 2 tail).

---

## Code review — general correctness bugs (2026-10-01)
Found in a dedicated correctness/quality pass (separate from the security/resilience/LLM buckets above). All verified by inspection.

**High — silently wrong user-facing output (no error, no test catches it):**
- [ ] **Feedback priority sorted alphabetically** — [apps/agent/scoring_engine.py:310](apps/agent/scoring_engine.py). `sort(key=x.priority.value)` orders strings `high < low < medium`, so LOW outranks MEDIUM and, after the top-8 truncation, real MEDIUM feedback is dropped. Fix: explicit rank map.
- [ ] **`normalizeWpm` band gaps** — [apps/server/src/analytics/normalization.ts:20](apps/server/src/analytics/normalization.ts). Integer-inclusive bands + float WPM → values in the 1-unit gaps (160.5, 119.5, …) fall through to score **3/10**. A near-ideal 160.5 WPM scores worst. Fix: contiguous bands or round before lookup.
- [ ] **Delete handlers ignore `res.ok`** — [apps/web/src/pages/History.tsx:286](apps/web/src/pages/History.tsx) (`deleteReplaySession`, `deleteElevateSession`, the bulk variants) and [apps/web/src/pages/Replay.tsx:283](apps/web/src/pages/Replay.tsx) (`handleDelete`). `fetch` doesn't reject on HTTP 4xx/5xx, so a failed delete still shows `toast.success` + optimistically removes the row. `Elevate.tsx` does it correctly — match that (`if (!res.ok) throw`).
- [ ] **`useSessionMetrics.fetchMetrics` stale-data race** — [apps/web/src/hooks/useSessionMetrics.ts:99](apps/web/src/hooks/useSessionMetrics.ts). No `cancelled`/AbortController guard; a fast session switch A→B shows A's metrics under B. The sibling `useSessionTurns` has the `cancelled` flag — apply the same.

**Medium — races / leaks / churn:**
- [ ] **Points double-award race** — [apps/server/src/lib/points.ts:9](apps/server/src/lib/points.ts) `awardFeedbackConsideredPoints` is check-then-act, not transactional; concurrent "mark considered" double-credits. Mirror the atomic `updateMany({where:{pointsAwarded:false}})` claim used for session points.
- [ ] **`saveSkillScoresToPulse` idempotency race + N+1** — [apps/server/src/analytics/progressPulse.ts](apps/server/src/analytics/progressPulse.ts). `count()===0` then `createMany` → duplicate pulse entries under concurrent analyze. Add a unique `(sessionId, skill)` constraint or atomic claim on `Session.progressPulseStatus`; move `getSmoothedScore` out of the per-entry loop.
- [ ] **Object URL leak** — [apps/web/src/hooks/useAudioRecording.ts:121](apps/web/src/hooks/useAudioRecording.ts) never `revokeObjectURL`s the prior/last blob URL.
- [ ] **Context value churn** — [apps/web/src/contexts/AuthContext.tsx:130](apps/web/src/contexts/AuthContext.tsx) & [FeatureFlagsContext.tsx:93](apps/web/src/contexts/FeatureFlagsContext.tsx) pass a fresh `value={}` object each render → widespread consumer re-renders (Navbar etc.). Wrap in `useMemo`.
- [ ] **Duplicate `loadConversation` fetch** on Elevate session open ([Elevate.tsx:982/989 + 1060](apps/web/src/pages/Elevate.tsx)); view-session effect over-fires on `searchParams` churn ([Elevate.tsx:1046](apps/web/src/pages/Elevate.tsx)).

**Low — dead code / hygiene:**
- [ ] **Dead duplicate agent entrypoints** — remove `apps/agent/main_working_audio_neel.py` and `main_working_audio_text_neel.py` (unreferenced forks of `main.py`).
- [ ] **Dead WebSocket path** — `subscribeToUpdates` in [useConversationPersistence.ts:187](apps/web/src/hooks/useConversationPersistence.ts) is never called; has latent effect-dep/double-close bugs if wired up. Wire carefully or delete.
- [ ] **Stale TODOs** — [sessions.ts:286](apps/server/src/routes/sessions.ts) ("Add DB persistence for conversation messages" — confirm not a data-loss path), [assistant.ts:9](apps/server/src/routes/assistant.ts) (`/assistant/text` stub).
- [ ] **Error-body parsing** — `useReplaySession` uses `(await res.json()).error` which throws on HTML/empty error pages; use the safer `res.json().catch(()=>({}))` form already used in `ReplayResults.tsx`.
- [ ] `computeActiveSessionSeconds` doc says "under 120s" but code is `<= 120`; index-based `key={i}` on some renderable lists; poll interval torn down each cycle in [Replay.tsx:274](apps/web/src/pages/Replay.tsx).

**Dependency hygiene:**
- [ ] **40 npm vulnerabilities** (2 critical, 25 high) — mostly dev/build transitive (`concurrently`, `shell-quote`, `glob`), but `express` + `fast-xml-builder` (AWS SDK) reach runtime. Run `npm audit fix`; add an `npm audit` gate to CI.

## Other observations (not yet ticketed)
- **Single-box SPOF** — one t3.large runs Postgres + LiveKit + Redis + egress + Gentle + API + agent (2GB swap). Realistic ceiling ~1–3 concurrent Elevate sessions before RAM/OOM. Scaling wall, not a bug.
- **Tracked env file** — `apps/agent/.env.production` is committed (placeholder values only; `*.pem`/`client_secret_*.json` are correctly gitignored). Consider untracking it.
- **Doc drift** — `Metrics-and-Analytics-Guide.md` (dated 2025-09) and `AUDIO_RECORDING_IMPLEMENTATION.md` (unchecked S3-lifecycle todo) predate current code.
- **Bugs found & fixed during the logging self-review** (4) are recorded in [LOGGING-CHANGES.md §7](docs/LOGGING-CHANGES.md) — no open action.
