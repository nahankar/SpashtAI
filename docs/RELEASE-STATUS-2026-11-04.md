# Release status — 4 November 2026 (supersedes PENDING-WORK-STATUS-2026-11-04)

Verified at the time of writing. Nothing below is merged, deployed or enabled; production changes need explicit
authorization. Evidence paths are local, ignored directories (never commit audio, recordings, auth or logs).

| Surface | Revision |
|---|---|
| GitHub `origin/main` | `17f4bb3717fecbc1f5049ddb8d20dabb6312b755` |
| EC2 `/opt/spashtai` | `17f4bb3` (only `infra/livekit/*.yaml` locally modified); web/API 200 |
| Local `main` | `d575f5d` — diverged from origin/main; left untouched |

## 1. Authoritative pending inventory

| # | Item | Branch @ SHA (pushed) | Merged / deployed | Depends on | Validation done | Remaining gates |
|---|---|---|---|---|---|---|
| A | Invitation signup location hotfix | `hotfix/invitation-signup-location` @ `82e883f` (impl `561f1ea`, docs `3e1b11b`/`3d00cd6`, tests `82e883f`) | No / No | main `17f4bb3` | See §2 | Clean full-suite run on a quiet machine/CI; owner review; deploy API only |
| B+C | Session lifecycle (`5351b92`) + delivery-alignment lease (`855cfba`, `c0ec02a`) | `release/session-lifecycle-lease` @ `94578a2` (= the 3 commits cherry-picked onto main; `range-diff` identical) | No / No | main `17f4bb3` | Server suite 756 passed / 124 skipped / 0 failed; typecheck; root build; real-audio §3 | Owner review; deploy API (+web unchanged) |
| — | ⚠ `tenancy-pilot-rc` @ `c0ec02a` | Do **not** deploy | — | — | — | It predates main's `de68bc1/bc43b34/17f4bb3`; deploying it would revert the live admin side nav (deletes `AdminSideNav.tsx`) and signup UX. Use `94578a2` instead |
| D | Voice test tool | `codex/voice-test-candidate` @ `6c8b3f1` (contains `7b57aaf`, `051039a`, `def1be3`) | Developer tool, never deployed | — | 76 unit tests; live runs §3 | — |
| E | Workspace Owner/Admin session review | `feature/workspace-session-review` @ `daf02ab` | No / No | main `17f4bb3`; migration `20261104120000_workspace_session_review` | §4 | Owner review of permission model + learner notice copy; Safari/Firefox + real WebM/Opus playback; deploy needs migration |
| — | Elevate recognizer watch (observe-only logging) | `fix/elevate-recognizer-watch` @ `923759e` | No / No | main | 32 agent unit tests; ran live in 3 Elevate runs | Optional diagnostic release (agent only) to catch the Northwind stall in production logs |
| F | Prepare/Coach in organizations | none (plan only) | — | — | — | See `docs/PREPARE-WORKSPACE-PLAN.md` |

Release recommendations (separate, in this order): **A** (API only) → **B+C** as `94578a2` (API) → **E** (migration + API + web)
after review. Northwind stall: no application fix yet (§3.3). Prepare: plan only.

## 2. Invitation location hotfix (A)

Implementation reviewed: pincode lookup runs outside the invitation row lock; a successful lookup wins, then an existing
location, then blanks; complete existing profiles are never rewritten (`isProfileComplete` guard); Personal
`/api/auth/google` uses the same helper.

Added in `82e883f`: incomplete existing profile gains the resolved location; complete profile untouched even when the
lookup returns a different city; Personal Google sign-up/sign-in keeps an existing city on a partial lookup.
Negative control: with `561f1ea`'s source reverted all three new/related tests fail.

Database runs (`WORKSPACE_TEST_DATABASE_URL=…55443/postgres`, migrated to `20261103160000`, no concurrent users):
* `invitations-database`, `invitations-small-pool`, `workspace-invitations-database`, `profile-location`,
  `workspace-enrollment`: 60/60 then 38/38 (+2 new) — covers new invitee, incomplete existing profile, partial/failed
  lookup, wrong Google account, unverified identity, expired/revoked/repeat acceptance, revoke/expire after Google
  verification, no account before profile fields, existing-user role/permission/history preservation, Personal
  Google sign-in, empty custom message.
* Full server suite on the hotfix: 1 of 5 runs fully green (756/124/0); the others had 1–9 failures in
  unrelated files (socket hang up, 5 s timeout in a fully mocked unit test, workspace RLS reads), none reproducible on
  targeted reruns; 1 of 15 consecutive invitation-suite loops failed in an unrelated production-mailbox test.
  Baseline `17f4bb3` was green 3/3 in the same window. Treat as **environment-load flakes, unproven** — gate: rerun on a
  quiet machine/CI before merge.
* Empty custom message email: subject "You're invited to {workspace} on SpashtAI", **Accept invitation** button, expiry
  and ignore notice, replies notice. Existing tests deliberately forbid default "invited to join" body copy — owner
  judgement whether a one-line default body is wanted.
* Production (read-only): 0 accepted invitations, 1 pending workspace invitation; 3 older non-invitation users have a
  pincode without city. No backfill is needed for this hotfix.

## 3. Real-audio voice validation

Isolated stack (all mine; shared services untouched): web `:5303`, API `:4130`, signal `:4041`, LiveKit container
`rc-livekit-8090` (`ws://localhost:8090`, single agent worker), database `127.0.0.1:55443/spasht_rc_94578a2`
(clone of `spasht_voice_5351b92`), workspace **Northwind**, fictional VTC accounts enrolled as learners.
Production parity: `WORKSPACES_ENABLED=true`, `WORKSPACE_SESSION_ARCHIVE_ENABLED=false`, no readiness override, and
Interview flags mirrored from production (`interview_conversation` hidden+disabled ⇒ **production Interviews are
manual for everyone, including KLSVDIT**; manual Finish/Skip/Next is therefore the production-relevant coverage).
Bank: two extra clearly-fictional reviewed questions added to the test DB (default selection needed ≥ 3).

Evidence root: `/Users/neelesh.ahankari/Applications/SpashtAI/tools/voice-test-candidate/runs/`

| Run | Tool | Web/API/agent | Scenario | Outcome | Evidence |
|---|---|---|---|---|---|
| 20261104-113643-ee2dd6 | def1be3 | 94578a2 / 94578a2 / 923759e | elevate-learner (7 min bound) | **Inconclusive** (bound reached); 7/7 replies saved, playback, delivery alignment completed | `workflow-2026-11-04T11-36-39-608Z/` |
| 20261104-114606-39e9ec | def1be3 | same | elevate-learner | **Not passed** — tool hang (reply decision never settled); launcher wrongly printed "passed" (tool defect, fixed `a718c64`) | `workflow-2026-11-04T11-46-02-420Z/` |
| 20261104-121421-b3bab4 | a718c64 | same | manual-interview | **Passed** 20/20 | `workflow-2026-11-04T12-14-15-985Z/` |
| 20261104-121656-90f02f | a718c64 | same | elevate-learner | **Failed [tool/setup]** — app correctly showed "End the other live session?" for the hung run's take; tool did not handle it (fixed `6c8b3f1`) | same workflow dir |
| 20261104-122033-46c894 | 6c8b3f1 (dirty→committed) | same | elevate-learner + real takeover | **Passed**, natural completion, 7/7 replies, alignment completed | `workflow-2026-11-04T12-20-29-946Z/` |
| 20261104-123129-b65718 | **6c8b3f1 clean** | **94578a2 ×3 verified** | manual-interview | **Passed** (finish-next → skip-next → finish-end) | `workflow-2026-11-04T12-31-24-127Z/` |
| 20261104-123359-4eaf0b | **6c8b3f1 clean** | **94578a2 ×3 verified** | elevate-learner | **Passed**, natural completion, 7/7 replies, alignment completed | same workflow dir |

Each run directory has `report.md/json`, `conversation.json`, `audio/incoming-1.wav`, `audio/mic-1.wav`, screenshots,
and the workflow directory has sanitized `api-run.log`/`agent-run.log`. Not covered: automatic Interview (not
production mode), physical devices, Safari/Firefox, provider quality.

### 3.1 Delivery alignment (lease)
Worker started with the API; lease row `automatic` present and released after claims; Elevate sessions completed via
the live-recording-clock path; Interview sessions (also eligible, `module='elevate'`, `purpose='INTERVIEW'`) first
failed `alignment_service_failed` because this worktree had no agent venv (bare `python3` lacked `aiohttp`), then
completed once the API used the agent venv (`AGENT_PYTHON`). Production has `apps/agent/.venv` with `aiohttp` and
Gentle reachable, and already has its lease row (no pending backlog), so the lease fix mainly protects fresh/unseeded
databases.

### 3.2 Session lifecycle
A live take abandoned by a hung client stays "active" for `VOICE_STALE_MS` = 6 h (unchanged from production); the next
start shows "End the other live session?" and **Take over** works with real audio (run 46c894). Observation: the
taken-over take keeps `audioStatus=pending` because takeover uses the "keep" path; harmless here, worth a product look.

### 3.3 Northwind `session_1793768850376_v90vec3ax` (unresolved, no app fix)
Traced from the preserved evidence and the original agent log (`/private/tmp/spasht-walkthrough/agent-logs/agent.log`):
* Publication/track: third reply present on the app mic track (`mic-1.wav`, 10:39:43–10:40:09 IST).
* Agent receipt + VAD: `on_end_of_speech` (`max endpointing delay updated due to pause … "new turn"`, pause 7.46 s) at
  10:40:09.811 — the agent's VAD, fed by the same frames as STT, saw the whole turn.
* Recognizer: no final, no interim (no live-partial bubble in `page-text-at-stop.txt`), no error, no
  "restarting transcribe session" between 10:39:33 and the 10:41:39 close.
* Ruled out by configuration/code (livekit-agents 1.5.8): adaptive-interruption transcript hold (session uses
  `interruption.mode="vad"`), uninterruptible-speech audio discard (only the opening greeting), echo filter (would log).
* Remaining explanation: Amazon Transcribe stream stopped returning results silently — the failure mode Interview
  already supervises (`interview_audio.RecognizerWatch` + `supervise_recognizer`); Elevate has no supervision.
* Not reproduced in 3 complete Elevate runs with the observe-only watch (`923759e`, 0 stall reports). Smallest next
  step with evidence: ship the observe-only watch (or run it longer locally); if it records a stall with frames
  forwarded and no results, reuse `supervise_recognizer` for Elevate's `stt_node` (testable with `inject_stt_fault`).

## 4. Workspace session review (E) — branch `feature/workspace-session-review` @ `daf02ab`

See `docs/WORKSPACE-SESSION-REVIEW.md` on that branch. Summary: new `reviewer` database reader enforced by
`workspace_review_reads()` (current active Owner/Admin of the active organization, `app.workspace_id` match, and a
READ ONLY transaction) with SELECT-only policies on `Session`/`ReplaySession` (organization only, not discarded,
Prepare-linked excluded); explicit field allowlists (no paths, provider details, answer guides, internal notes); a
review media ticket with range support; content-free audit rows per access; Workspace Admin → Sessions (learner/
product/status/date filters) and Users → learner → Sessions; learner notice: "Organization activity stays in this
workspace, and its Owners and Admins can review your sessions here. Your Personal history remains separate and
private." Learner self-view flags (`hideTranscriptText`, `hideAudioDownload`) do not restrict review (documented).

Validation (dedicated `spasht_review_test`): 10 DB files / 93 tests incl. 13 review tests (two orgs + Personal, role
demotion, member/workspace suspension, known-ID probing, 206/416 ranges, read-only enforcement with a negative control,
content-free audit); server 619 passed (DB skipped), web 389 passed, typechecks, lint, build; headless Chromium
playback with seeking (WAV). Independently re-run: review + archive suites 29/29. Added `daf02ab` so database tests
refuse walkthrough/voice databases. Remaining: Safari/Firefox and real WebM/Opus recordings; Prepare review.

## 5. Prepare in organizations (F)

Plan only: `docs/PREPARE-WORKSPACE-PLAN.md` (milestones M1–M4, acceptance criteria; ships independently of Coach).
