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

## Other observations (not yet ticketed)
- **Single-box SPOF** — one t3.large runs Postgres + LiveKit + Redis + egress + Gentle + API + agent (2GB swap). Realistic ceiling ~1–3 concurrent Elevate sessions before RAM/OOM. Scaling wall, not a bug.
- **Tracked env file** — `apps/agent/.env.production` is committed (placeholder values only; `*.pem`/`client_secret_*.json` are correctly gitignored). Consider untracking it.
- **Doc drift** — `Metrics-and-Analytics-Guide.md` (dated 2025-09) and `AUDIO_RECORDING_IMPLEMENTATION.md` (unchecked S3-lifecycle todo) predate current code.
- **Bugs found & fixed during the logging self-review** (4) are recorded in [LOGGING-CHANGES.md §7](docs/LOGGING-CHANGES.md) — no open action.
