# Release status — 5 November 2026 (supersedes RELEASE-STATUS-2026-11-04)

Nothing here is merged, deployed or enabled. Production (`/opt/spashtai`) and `origin/main` are still
`17f4bb3`. No real invitations were sent; all accounts are fictional; evidence paths are private, ignored locations.

## 1. Inventory

| Item | Branch @ head | Commits beyond `17f4bb3` | Deploys | Status |
|---|---|---|---|---|
| A. Signup location + invitation email | `hotfix/invitation-signup-location` @ `c298986` | `561f1ea` lookup outside lock · `82e883f` tests · `bb693d2` postcode/country-aware merge · `fdca221` test harness · `c298986` empty-message copy · docs `3e1b11b` `3d00cd6` | API | Ready for review |
| B. Session lifecycle + lease + LiveKit room ownership | `release/session-lifecycle-lease` @ `39b6c0e` | `1d99a5f` `679f359` `94578a2` (= `5351b92` `855cfba` `c0ec02a`) · `af4da49` server-bound rooms, fail-closed release · `39b6c0e` test harness | API + web together | Ready for review |
| E. Workspace Owner/Admin session review | `feature/workspace-session-review` @ `89b6cd2` | `e7843de` `f9f065c` `a3dbd34` `daf02ab` · `9126708` Nginx log hardening · `0761e23` test harness · `3b0af32` ticket expiry test · `89b6cd2` test guard | migration `20261104120000_workspace_session_review` + API + web + Nginx | Ready for review; Safari pending |
| Voice tool | `codex/voice-test-candidate` @ `6c8b3f1` | contains `051039a`, `a718c64`, `6c8b3f1` | never | In use |
| Recognizer diagnostics (observe-only) | `fix/elevate-recognizer-watch` @ `923759e` | logs only | agent | Optional |
| Prepare plan | this branch | `docs/PREPARE-WORKSPACE-PLAN.md` corrected (M3b) | — | Plan only |

`tenancy-pilot-rc` (`c0ec02a`) must not be deployed: it would revert live `17f4bb3` UX. Pairwise `git merge-tree`
of A, B and E: all clean (they share only the identical test-harness change).

## 2. What changed and why

**B — LiveKit room ownership (security).** Segment creation accepted a client `roomName`; resume, retry, takeover
and the session-deletion worker then closed rooms, stopped Egress and deleted Egress-listed storage *by that stored
name* without checking ownership. Token issuance and dispatch already refused a live room whose metadata named another
activity, and `SessionSegment.roomName` is unique, so registering a name another segment in the same database already
holds was blocked. Residual exposure: pre-claiming a not-yet-used name, and rooms on a shared LiveKit server that this
database does not own (e.g. another environment/stack). Inherited: the deletion-worker path (in `17f4bb3`/production).
Introduced by `1d99a5f` (`5351b92`): the segment-start release paths. Fix (`af4da49`): rooms are named by the server as
`lk_` + HMAC(JWT secret, `livekit-room:v1`, [sessionId, segmentId]); client names are ignored and the web client joins the
name the API returns. Release/deletion acts only on provably owned rooms (derived name, or live room metadata naming the
segment); foreign rooms, their Egress and storage are never touched; recorded Egress ids are still stopped by id.
Live rooms created by much older code without `segmentId` metadata are treated as not owned (left to expire).

**B — fail closed.** A non-empty release with missing `LIVEKIT_URL`, key or secret now throws; segment creation keeps
the other take's occupancy and returns 503 `VOICE_ROOM_RELEASE_FAILED`; the deletion worker keeps the tombstone and
retries. Empty lists remain no-ops; LiveKit "room not found" remains success.

**A — location merge.** Lookup results always win; existing city/state/country fill gaps only for the same normalized
postcode and same country; changed/unknown old postcode or another country leaves unresolved fields blank (never
`Mysuru / Karnataka / United States`). Google sign-up no longer re-applies the stored city after merging. Lookups stay
outside the acceptance transaction; complete profiles and Personal history are unchanged.

**A — empty custom message.** Body now opens with "{Organization} has invited you to practise on SpashtAI."
(Personal: "You're invited to practise on SpashtAI."); subject, Accept button and expiry/ignore notices unchanged.
Observation (not changed): the acceptance page says "an organization workspace" without naming it.

**All branches — full-suite failures root-caused (`fdca221`, cherry-picked).** Not environmental: supertest's
`request(app)` listens on `[::]:P` but connects to `127.0.0.1:P`; on macOS another process's IPv4 listener on that
ephemeral port receives the connection (captured: an Express HTML 404 from a foreign server). Measured: ~1 misrouted
request per 1,500–4,000 before; 0/12,000 after connecting over `[::1]`. Main `17f4bb3` failed 2/5 full runs before;
A passed 5/5 after (load 9–30). Ruled out with evidence: env leakage between files (probe), file order (same seed
green twice). A separate, reproduced mechanism remains: under synthetic CPU saturation a DB test can exceed vitest's
default 5 s timeout and cascade within its file.

**E — logs.** Production Nginx (`combined` format, same as repo) would write `review_media`/`workspace_media` tickets,
LiveKit `access_token` and password-reset tokens to `access.log`, and to `error.log` on upstream failure. `9126708`:
all vhosts log path + `[query]` (referer reduced likewise); ticket-bearing stream routes and LiveKit `/rtc` keep
upstream errors out of `error.log`. Production logs currently contain 0 such tokens (read-only count).

## 3. Tests actually run (all local, dedicated databases)

| Branch | Result |
|---|---|
| A | Server suite 5/5 runs 758 passed / 124 skipped / 0 failed; typecheck; build. Location negative control: 5 tests fail on old merge |
| A browser (Playwright Chromium; **Google mocked**) | 14/14: link opens no account; Google button only after workspace + profile details; wrong account and unverified identity refused with no account; accepted with location + workspace answers; lands in org; repeat acceptance idempotent (1 user, 1 org membership); expired and revoked links offer nothing; existing account keeps profile/permissions/role/Personal history; ordinary Google sign-in works |
| B | Server suite 2/2 runs 772 passed / 124 skipped / 0 failed; web 383/383; typecheck; build. Mutation controls: client names, release without ownership, missing-config no-op each caught |
| E | Server suite (own DB, 2 shared-DB-pinned invitation files excluded) 712 passed / 124 skipped; workspace invitations 14/14 on both DBs; web 389/389; typecheck; build; ticket-expiry mutation caught |
| E browsers (real app-recorded WebM/Opus, no duration/cues; restricted DB role) | Playwright Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2: list excludes Personal + other org; load via ticket; play advances; seek to 200 s fires `seeked` and keeps playing. Real Safari 26.4 **not tested** |
| E logs | Nginx 1.28.3 canary harness with the repo vhosts: 0 canaries in access/error logs for credential routes; API log: 7/7 real stream requests `review_media=[redacted]` |

Real-audio voice (tool `6c8b3f1` clean; web/API/agent verified `39b6c0e`; Northwind; LiveKit `:8090` single agent):
`20261105-062143-044ced` elevate-learner **passed** after confirming takeover of an API-created leftover take
(5/5 replies saved, recording plays, delivery alignment completed); `20261105-062758-042786` manual-interview
**passed** (finish→next, skip→next, finish→end). Leftover segment closed; 0 release failures, 0 errors; issued rooms
`lk_…`. Evidence: `tools/voice-test-candidate/runs/workflow-2026-11-05T06-21-37-028Z/`. Earlier failed/inconclusive
runs (4 November) are preserved unchanged.

## 4. Remaining items, prerequisites and decisions

* **Real Safari** (owner, one-time): enable Safari → Settings → Advanced/Developer → "Allow remote automation"; the
  same check then runs against Safari 26.4.
* **Real Google** (owner): automated tests use a mocked identity. One manual pass of the invitation link with a real
  invited Google account on a non-production stack is still required.
* **Decision — learner self-view flags:** session review ignores `hideTranscriptText` and `hideAudioDownload`; they
  are learner-only display preferences, still honoured in the learner's own archive. Organization review scope is
  decided only by the database reviewer policy (active Owner/Admin, current active organization, read-only).
* **Product:** MediaRecorder WebM has no duration — native controls show unknown/wrong length (Chromium/WebKit
  `Infinity`, Firefox estimate) although programmatic seeking works; affects learner playback too.
* **Product:** acceptance page could name the organization (email now does).
* **Northwind `session_1793768850376_v90vec3ax`:** unresolved. Audio reached the agent (VAD end-of-speech logged);
  Transcribe returned nothing and no error. New evidence: replaying the incident's own `mic-1.wav` through the identical
  plugin/configuration transcribes turn 3 (2 finals, 51 interims), so the content was not the cause. Not established:
  provider stream stall vs. frames not reaching STT. Next step: ship or run the observe-only watch (`923759e`), whose
  `frames_forwarded` count distinguishes the two; only then consider reusing Interview's recognizer supervision.
* Taken-over takes keep `audioStatus=pending` (by design "keep"); harmless, worth a product look.

## 5. Proposed release order (each needs explicit authorization)

1. **A** — API only.
2. **B** — API and web together (the web joins server-named rooms; an old cached web client fails to join until reload).
3. **E** — database migration, then API, web and Nginx (`deploy.sh` installs `conf.d/spasht-log-no-query.conf`;
   the Nginx change also protects existing `workspace_media` tickets and could ship earlier on its own).
4. Optional: recognizer watch (agent). Prepare: plan only; readiness stays disabled.
