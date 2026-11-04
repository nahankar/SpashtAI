# Automated voice workflow validation — 4 November 2026

Implementation branch: `codex/voice-test-standard-workflow`, based on existing testing branch
`codex/voice-test-candidate` at `2e05b2c`. It uses a separate worktree; other checkout contents, existing
credentials, and shared service processes were preserved. No application/deployment changes are included.

## Changes

- Root `AGENTS.md` plus always-applied Cursor guidance require relevant real-audio candidate scenarios,
  evidence/log inspection, honest results, bounded local runs and narrowly justified human assistance.
- `npm run voice:preflight -- ...` checks local app/API/LiveKit, candidate providers, browser authentication,
  workspace scope, API binding and local log availability. It does not claim that a live voice test passed.
- `npm run voice:test -- ...` runs selected existing scenarios serially, preserves outcomes and saves bounded,
  sanitized log tails and evidence under the ignored tool `runs/` directory.
- Workspace UI navigation uses the real picker and existing links. Diagnostic reads carry the workspace token
  observed from that browser; missing scope cannot silently fall back to Personal.
- Origin protection prevents a local candidate from sending app API/session requests to production.
- Numeric run limits and missing/required-skipped evidence cannot result in an accidental pass.

Exact commands, isolation setup and one-time dependencies/authentication are in the tool README's
“Standard agent workflow” section. No owner spoken test was requested. Existing local STT/TTS/Ollama,
walkthrough API 4100/web 5273/LiveKit 7880 and agent logs were reused. Providers process real audio; the app
voice pipeline still uses external services, so this is local targeting, not an offline test.

The running stack's source directory was the tenancy checkout at `8a6e6c4`; an exact in-memory build stamp
is not exposed by that pre-existing process. These results validate the candidate workflow and observed local
behavior, not a fresh production release certification. Production revision and RLS were checked read-only.

## Evidence and outcomes

Paths below are relative to `tools/voice-test-candidate/runs/` and are deliberately not committed.

| Scenario | Target/account | Outcome | Evidence |
| --- | --- | --- | --- |
| confident-interview | Northwind fictional learner | Passed: actual heard question, spoken answer, natural bank exhaustion, saved transcript/recording/assessment/history/playback | `workflow-2026-11-04T05-14-40-223Z/20261104-051444-270e07/report.md` |
| elevate-learner | Personal fictional platform test account | Inconclusive: natural coach completion, transcript/recording/metrics/history passed; alignment pending | `workflow-2026-11-04T04-41-30-496Z/20261104-044152-fdb01c/report.md` |
| elevate-learner | Northwind fictional learner | Failed: three spoken turns, then coach silent for 90 seconds; transcript/recording preserved; alignment also pending | `workflow-2026-11-04T05-07-25-789Z/20261104-050729-3fe782/report.md` |

Earlier blocked runs remain preserved: direct organization entry exposed an application login-bootstrap
problem; Personal Interviews lacked access; initial organization UI setup needed tool readiness waits.
The tool waits were fixed and the affected scenarios retried. Remaining product failures were not reclassified.

## Completion limits

- A single fictional Interview question does not establish multi-question progression or manual Next.
- Delivery alignment still pending means Elevate end-to-end validation remains incomplete.
- Local Northwind speech loss/silence needs product diagnosis; no provider/model/prompt rewrite was attempted.
- Provider model reachability alone does not prove generation, agent dispatch or audio transport.
- Physical devices/acoustics and subjective coaching/technical grading quality are not exercised.
- Private deployed-code findings are recorded in ignored `docs/SECURITY-ISSUES.md` in this worktree; no secrets
  or production learner content have been committed.

Final tool checks: 45 tests across 7 files passed; tool typecheck and `git diff --check` passed.
Interview was repeated after API-origin protection was added and passed again. Captured incoming/microphone
WAV durations and signal energy were inspected alongside the independent conversation and API/agent logs.
No subjective audio-quality claim is made. Neither recordings nor private authentication/log state are tracked.

## Follow-up — 4 November 2026 (branch `codex/voice-test-candidate`, fast-forwarded to 7b57aaf)

7b57aaf was reviewed and reused (no second launcher). Its preflight, launcher, workspace navigation and
API-origin guard are extended; an origin violation now blocks the run instead of only being logged.

### Added

- `manual-interview`: listens to real questions, speaks, then uses **Finish answer → Next question**,
  **Skip question → Next question**, **Finish answer → End practice**. Verifies the saved run mode (manual),
  ANSWERED/SKIPPED/ANSWERED, per-reply saved answers, feedback, recording content and browser playback.
  Automatic (`confident-interview`) and manual coverage are separate scenarios and reports.
- Preflight levels **reachable / configured / observed-registered** (never "verified by live audio"): provider
  model listing, process targeting (web→API, API→LiveKit, agent→LiveKit + API callback, exactly one worker),
  agent registration since its latest start, per-account access, Interview coverage of the default selection
  and account mode. `npm run voice:help` documents options and what cannot be verified automatically.
- Application provenance per component (verified / unverified / unknown), separate from the tool revision.
- Saved-recording checks: availability, playback advancing via the page's main transport control, decoded
  content containing the candidate's speech. Live capture, saved recording and speakers are labelled apart.
- Failure evidence: voiced time on the app microphone track per reply, saved-transcript coverage with
  potentially missing turns, state at stop, pending vs completed vs failed processing, and
  application/tool/setup attribution on every non-pass reason. Whole-run watchdog; owner-only evidence files.
- 68 unit/integration tests (safety boundaries: wrong/production API binding, workspace scope loss, auth and
  access failures, invalid limits, whole-run timeout, interruption, redaction/private output, missing evidence).

### Live validation (isolated stack; apps tree identical to 81c393b; web/API/agent verified)

Isolated: web :5173, API :4000 on a cloned database `spashtai_vtc` (automatic conversation granted per account
there), signal :4011, own LiveKit (:7980, later :7990) and one agent. Accounts are fictional. Evidence is under
ignored `tools/voice-test-candidate/runs/`.

| Scenario | Outcome | Evidence (`runs/…`) |
| --- | --- | --- |
| manual-interview | passed (20/20 checks; Finish/Skip saved in ~1–2 s) | `workflow-2026-11-04T06-17-03-331Z/20261104-061708-e830fa/` |
| confident-interview (automatic) | passed (6 questions; practice time up; 18/18) | `workflow-2026-11-04T05-52-16-500Z/20261104-055609-b9b916/` |
| silence-interview | passed (20 s silence, no re-prompt; 6 questions) | `workflow-2026-11-04T06-17-03-331Z/20261104-061924-75c9ac/` |
| elevate-learner (clarity) | passed (5 replies all saved; recording content, playback, processing completed; 15/15) | `workflow-2026-11-04T06-38-08-325Z/20261104-063812-b6a320/` |

Tool defects found by these runs and fixed (failures preserved, not reclassified): playback baseline read during
the page's WebM duration probe; a 30 s Playwright wait on a missing alert in the manual flow; play-control
selection hitting the Playback tab and moment clips. Another session's agent registered on this stack's first
LiveKit (:7980); preflight blocked, and this stack moved to :7990 without touching the other session.

Application findings for the owners are in `docs/VOICE-TEST-FINDINGS-2026-11-04.md`. Not re-run today:
`hesitant-interview` (unchanged code paths) and the Northwind walkthrough stack (one reviewed question; owned by
another task).
