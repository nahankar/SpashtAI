# Organization product plane: progress record

Branch: `codex/workspace-product-access` from `origin/main` `d90bccf` (production revision on November 3, 2026).
Worktree: `VI/worktrees/spashtai-tenancy`. Test database: dedicated container on `127.0.0.1:55443` only.

Status words used here have fixed meanings:

| Word | Meaning |
| --- | --- |
| Implemented | Code exists on the branch |
| Tested | Automated tests pass against the restricted (NOSUPERUSER, NOBYPASSRLS) role |
| Merged | On `origin/main` |
| Deployed | Running on production with the revision verified |
| Human-verified | Checked by a person with real Google sign-in and microphone |

Nothing on this branch is merged, deployed or human-verified yet. No deployment is authorized.

## Baseline (verified November 3, 2026)

- `origin/main` = production = `d90bccf`. Production has only the LiveKit overlay modifications; both PM2 services online; `/ready` ready.
- KLSVDIT (production, read-only check): ACTIVE, FOUNDATION_ONLY, 500 seats, 299 daily evaluations, 200 concurrent voice,
  Asia/Kolkata, one active Owner, no entitlements, no invitations, no organization activity.
- Baseline server suite: 687 passed, 124 skipped.

## Architecture

- **Request scope.** A product request opens an organization only with header `x-spasht-workspace` (the workspace
  token) next to the normal identity token in `Authorization`; both must name the same person. Membership, workspace
  state and database placement are rechecked on every request (`workspaces/requestScope.ts`). Failure is an error,
  never a silent fall back to Personal. Platform `/api/admin` and `/internal` reject a workspace header.
- **Data plane.** The verified scope lives in AsyncLocalStorage (`lib/dataScope.ts`). The shared Prisma client
  (`lib/scopedPrisma.ts`) sets transaction-local context for every model call, raw query and transaction issued
  under a scope. Personal calls are unchanged. Handlers therefore get row isolation without being rewritten.
- **Database.** Forced RLS plus SECURITY DEFINER triggers (`20261103090000_workspace_product_plane`):
  new roots take their workspace from the verified context, ownership is immutable, and every parent/sibling link must
  stay in one workspace and with one learner. Personal rows are invisible inside an organization and vice versa.
- **Manager reads.** Owners/Admins can count their own organization's Session, Replay, Pulse, usage and feedback rows
  only under `app.workspace_reader='manager'`, which the database rechecks against the current role. Child tables with
  raw content (transcripts, turns, recordings, Replay results, interview answers) are never visible in that mode.
  Root rows still contain some learner context, so workspace admin services must select allowlisted columns only.
- **Jobs.** `workspace_job_scopes(job)` returns only (workspace, learner) pairs with due work. Each job re-establishes a
  fresh verified scope (`withJobScope`); an ended membership stops processing. Deletion uses `withCleanupScope`.
- **Feature decision.** Platform switch operational → active workspace and member → entitled and enabled → member
  override or default → product readiness. Inside an organization the entitlement replaces Personal pilot grants,
  and a platform `ADMIN` role grants nothing (`isPrivilegedRole` is false under a scope). Plan time and export actions
  come from the workspace (`pro`/`ultra`, `text_export`/`audio_export`/`reprocess`).
- **Readiness.** `WORKSPACE_FEATURE_READINESS` in `workspaces/productAccess.ts` is product code, identical for every
  organization. A product is switched on only after its full organization path is tested.

## Checkpoints

| # | Scope | Implemented | Tested |
| --- | --- | --- | --- |
| 1 | Scoped data plane, migration, request/job scope, access rules | Yes | Yes |
| 2 | Elevate voice: agent scope, callbacks, live updates, media, workers, voice concurrency | Yes (server, agent) | Yes (server, agent unit) |
| 3 | Replay: uploads, storage keys, processing, playback, export, deletion | Yes (server) | Yes |
| 4 | Interviews: runs, attempts, evaluator workers, tenant evaluation budget | Yes (server) | Yes |
| 5 | Workspace admin APIs: dashboard, users, invitations, feedback, usage, Pulse, AI Analytics, settings | Yes | Yes |
| 6 | Web shell `/w/:slug`, role navigation, workspace header, namespaced browser storage, admin pages | Yes | Yes (unit, render, and local fictional-account walkthrough; not Google/microphone) |
| 7 | Prepare/Coach (isolated at the data level; not offered; Coach refuses a workspace scope) | Data only | Data only |
| 8 | Docs, review, push; deployment only after authorization | Docs updated | — |

## Checkpoint 1 evidence

- `test/workspace-product-plane-database.test.ts` (restricted role): two organizations plus Personal with the same person
  in both; known foreign IDs through model calls, raw SQL, interactive and batch transactions; forged workspace on
  create; ownership moves; suspended member and outsider writes; cross-workspace Pulse/Prepare/Replay links;
  manager aggregate reads without Replay or Session transcripts; forged manager reader by a learner; separate
  organization acknowledgment; job discovery and job scope for suspended/foreign members; request binding with
  identity mismatch, forged token, platform Admin path, stale token after suspension and forged membership id.
- `test/workspace-scope-access.test.ts`: platform role ignored in organizations; workspace export actions; entitlement
  replaces Personal grant; interview practice, conversation and plan time from the workspace.
- `scripts/verify-workspace-migration.mjs`: legacy Replay/Pulse/usage/acknowledgment rows backfill to Personal; all
  42 isolated tables enforce forced RLS.
- Found and fixed during testing: manager mode exposed raw child content (Replay transcripts, Session children) through
  parent visibility. Child policies now require non-manager reads.

Readiness for Elevate, Replay and Interviews stays `false` after checkpoints 2–4: the browser path (checkpoint 6)
is part of each product's organization path. Tests switch readiness on locally only.

## Checkpoint 2 evidence (Elevate voice, commit `8cd8c78`)

- Organization recordings and merged audio live under `workspaces/<workspace>/sessions/<session>/`
  (`lib/mediaStorage.ts`); playback and audio resolution refuse any path outside that prefix, including symlinks.
  The legacy unauthenticated `/audio/local/...` route now serves Personal sessions only.
- LiveKit room and dispatch metadata carry a signed agent scope (audience `agent-callback`, 36 h); the agent
  (`apps/agent/agent_scope.py`) returns it on every callback in `x-spasht-workspace-scope`. The server honours it only
  with the internal agent token and only for the session it names.
- WebSocket subscriptions require the workspace token for organization sessions and recheck membership on every event.
- Workers (pace, delivery alignment, inactivity, audio enrichment, deletion) sweep Personal first, then each due
  (workspace, learner) in a fresh job scope; deletion runs in cleanup scope and also removes elevate Pulse rows and files.
- Voice concurrency: per-workspace advisory lock plus open-segment count when a segment starts; over the limit returns
  429 `VOICE_CAPACITY_REACHED`, serialization conflicts return 409 `SEGMENT_RETRY`.
- `test/workspace-elevate-database.test.ts` (7 tests): prefixed upload and playback, foreign path refusal, concurrent
  segment race at limit 1, agent callback with valid/forged/stale scope, WebSocket isolation, cleanup-scope deletion,
  job sweeps skipping suspended members. `apps/agent/test_agent_scope.py` (5 tests) plus existing agent suites.
- Not yet verified with a real LiveKit room, real agent process or microphone.

## Checkpoint 3 evidence (Replay, commit `20dd626`)

- Uploads, pasted text, transcription cache and S3 keys use the workspace prefix; audio/video upload and playback
  require the organization plan (`pro` for audio, `ultra` for video); downloads check the prefix.
- Background processing outbox rows carry the workspace, so processing and FeatureUsage stay in the organization.
- `test/workspace-replay-database.test.ts` (6 tests): entitlement and readiness gate, prefixed files, list/result
  isolation across Personal and a second organization, background text processing inside the workspace, foreign
  path 404, plan gate, deletion.

## Checkpoint 4 evidence (Interviews, commit `2cbfdfc`)

- Practice start, conversation and learner grading use the workspace decision instead of Personal pilot grants; the
  platform `interviews`, `interview_voice` and `interview_adaptive` switches still act as kill switches.
  Grading models, prompts and policies are unchanged.
- Each organization has a daily evaluation budget (`Workspace.dailyEvaluations`) counted on its own calendar day
  (`Workspace.timeZone`); over the limit the answer is saved and its assessment fails with
  `EVALUATION_WORKSPACE_BUDGET_REACHED`. The per-learner allowance is counted per workspace, so organization grading
  never uses a person's Personal allowance. The platform-wide shared cap (`learner-global`, 300/day) still applies to all.
- Evaluator usage rows carry the workspace; the worker grades organization work only in a verified job scope.
- `test/workspace-interviews-database.test.ts` (3 tests): Interviews open only in the entitled organization (Personal
  and the unentitled organization get 403, runs invisible outside), budget on the organization day, the Personal
  worker cannot claim organization work, the all-scope sweep grades it with usage attributed to the workspace,
  findings 404 outside the organization, time-zone day boundaries.
- Personal regression: the 8 interview/analytics/invitation DB suites hard-wired to `55441/simple_bank` were run as
  temporary copies against a scratch database on 55443 (157 passed, 4 skipped); copies deleted. One fix was needed in
  `interview-practice-database.test.ts` for the new acknowledgment unique key.

## Checkpoint 5 evidence (workspace admin APIs, commits `4ad599d`, `fcd3ba7`, `6394972`)

- Owner/Admin routes under `/api/workspaces/current/admin/...`: overview, day-wise activity, learner activity, feature
  usage, Progress Pulse, feedback, and AI Analytics (interpret, run, saved plans). They read only aggregate-visible rows
  of the current organization with allowlisted columns, bucket days in `Workspace.timeZone` and zero-fill periods.
- AI Analytics compiles a question into one of five allowlisted report plans; a named learner must be a member of this
  workspace. Saved plans live in `WorkspaceAnalyticsQuery` (forced RLS), so they are per organization.
- Members are paged (50) and searchable. Learner feedback inside an organization needs the `feedback` feature, stores
  attachments under the workspace prefix and takes numbers from a sequence (a row count under RLS would collide).
  Platform staff handle all feedback in the audited platform context.
- `test/workspace-admin-analytics-database.test.ts` (9 tests): learners and outsiders refused; organization-day grouping
  that never counts Personal or the other organization; learner filter limited to the workspace and empty zero-filled
  results; Pulse/usage/overview without raw content; feedback list without session links; member paging and search;
  AI Analytics learner binding, allowlisted plans and per-organization saved plans; feedback gate and numbering;
  platform feedback handling.

## Checkpoint 6 evidence (browser, commits `a185bd5`, `e31bf38`)

- **Workspace session.** `/w/:slug` enters the workspace, accepts a pending membership, and keeps the 15-minute
  workspace token in memory only (never in storage or URLs). It renews every 10 minutes, on return to the tab and on any
  workspace failure. A network error retries; a server refusal ends the workspace; nothing can reopen it after leaving
  (guards after every await). Product requests carry `x-spasht-workspace`; workspace failures never sign the user out
  or fall back to Personal.
- **Browser state.** Resumable-session keys are namespaced per workspace. A recording uploads, and a live-update
  subscription runs, with the workspace it started in; after a switch the stale token fails closed.
- **Playback.** Organization recordings play through a two-hour ticket bound to one session and person
  (`POST /api/sessions/:id/recording/ticket`, then `?workspace_media=`), rechecking membership on every range request.
  Tickets are redacted from logs.
- **Navigation.** Learner links come only from the member's own feature decisions (Elevate, Replay, Interviews,
  Progress, Feedback). Coach and Prepare are not offered; `/api/coach` returns 403 `WORKSPACE_FEATURE_UNAVAILABLE`
  in an organization. Owners/Admins also get Dashboard, Users, Invitations, Feedback, Feature usage, Progress Pulse,
  AI Analytics and Workspace settings, all on the workspace API, never on platform `/admin` routes.
- **UI.** Workspace and platform workspace screens use shadcn Select, Switch, Table, Checkbox, RadioGroup, Accordion,
  Dialog and AlertDialog; no native select, table, details or checkbox remain there.
- Tests: server `workspace-elevate-database.test.ts` (8, including 9 ticket cases and the Coach guard); web
  `activeWorkspace.test.ts`, `WorkspaceFeatureFlags.test.tsx`, `shell/session.test.ts` (7), `shell/model.test.ts`,
  `shell/render.test.tsx`, updated `EnrollmentForm.test.tsx`.
- Latest full runs (November 3): server 724 passed, 124 skipped; web 363 passed; web type check and production build
  pass; OpenAPI validates. Lint errors remain only in four pre-existing platform admin files.
- Local browser walkthrough (November 3, commit `0f3472a`): see below. Not human-verified.

## Release gates

| Gate | State |
| --- | --- |
| Server isolation tests on the restricted role | Pass |
| Migration upgrade verifier | Pass (November 3, after checkpoint 6: 42 tables enforce forced RLS) |
| Browser walkthrough with fictional local accounts (two organizations plus Personal) | Local Replay walkthrough done November 3 (commit `0f3472a`); Elevate and Interviews opened locally only. Not human-verified with Google or a microphone |
| Product readiness flags (`WORKSPACE_FEATURE_READINESS`) | All organization products still `false` in product code. Local `WORKSPACE_READY_OVERRIDE` is ignored in production |
| Real Google sign-in, microphone, LiveKit room and agent in an organization | Human check, not done |
| Merge to `main` | Not done |
| Deployment (backup, active-session check, migration, runtime role, rollback plan) | Not authorized |

With readiness `false`, a deployed build would give Owners/Admins the admin pages (with empty reports) while learners
see no products. That is still the production posture. The local override is walkthrough-only.

## Known gaps and decisions

- Platform Admin analytics run without a workspace context and therefore show Personal activity only. Organization
  analytics are on the workspace admin pages.
- A playback ticket lasts two hours; a Replay page left open longer must be reopened to seek.
- Microsoft Clarity: the workspace shell reloads the page once if Clarity was already loaded, so organization pages
  are not recorded. Platform `/admin` has the same pre-existing gap and is unchanged.
- Admins see progress and usage, not raw content: transcripts, recordings, Replay results and interview answers stay
  learner-only by database policy.
- Flaky under parallel load: invitation database suites (shared mailbox and fixtures across parallel files) and once a
  `socket hang up` in the in-memory `preparations.test.ts`. Each passes alone; three consecutive full runs after
  checkpoint 4 were clean (714 passed, 124 skipped). After checkpoint 6, `replay-workflow-evidence.test.ts` failed once
  under full parallel load and passed alone three times and in the next full run. Not caused by isolation changes; tracked.
- The platform-wide learner evaluation cap (300/day) is shared by Personal and all organizations; KLSVDIT's 299/day
  budget can therefore be limited by platform demand. Raising it is a platform cost decision.
- Interview database suites are hard-wired to the other checkout's database on 55441 and are not run there.

## Local walkthrough (November 3, latest commit `0f3472a`)

Isolated stack only: API `:4100` as `walkthrough_app` on `127.0.0.1:55443/spasht_walkthrough` (`NOSUPERUSER`,
`NOBYPASSRLS`), web `:5273`, `NODE_ENV=development`, `DEV_LOGIN=true`. Production host and the editor checkout at
`81c393b` were not touched. `WORKSPACE_FEATURE_READINESS` is still all `false` except `pro`/`ultra`.
`WORKSPACE_READY_OVERRIDE` was `replay`, then `replay,elevate`, then `replay,elevate,interviews`. Production
ignores that override.

**Development login.** `POST /api/auth/dev-login` is 404 `DEV_LOGIN_DISABLED` in production even when `DEV_LOGIN=true`
and the route is called directly. Live local checks: `anyone@example.com` → 401 `DEV_LOGIN_REJECTED` (user lookup not
reached); unknown `@walkthrough.test` → 401; `learner@` / `owner@` → 200. Google and `/api/auth/login` are unchanged.
Six unit/HTTP tests cover the gate.

**Auth contract.** Product routes: identity Bearer plus `x-spasht-workspace`. Workspace admin `/api/workspaces/current/*`:
workspace JWT as Bearer (`workspaceCall` / `currentWorkspaceRequest`). Documented on `api-client.ts` and
`workspaces/client.ts`. Live fail-closed: invalid header 401 `WORKSPACE_TOKEN_REQUIRED`; identity/workspace mismatch
403 `WORKSPACE_IDENTITY_MISMATCH`; identity Bearer on admin 401 `WORKSPACE_TOKEN_REQUIRED`. An absent workspace header
is Personal, not an organization fallback. Coach in an organization remains 403 `WORKSPACE_FEATURE_UNAVAILABLE`.

**Replay (browser, displayed data).** Learner sees Replay only; no Admin, Elevate or Interviews until those
overrides. Feedback is unfinished: entitled but readiness false, page copy
“This product is not yet available in organization workspaces.” History: Northwind shows only Northwind sessions;
Brightpath only Brightpath; Personal only Personal. Northwind (standard) audio control is locked (“Coming soon”);
Brightpath Pro upload of `tone.wav` returned 200, opened results, and was deleted from history. Opening the Brightpath
result id from Northwind shows “Replay session not found.” Owner Admin nav is present. Users page lists only
Northwind members.

**Progress Pulse (displayed values, not HTTP 200).** Seeded Northwind: learner clarity 8 + confidence 6, owner
clarity 4. Admin UI last 30 days in `Asia/Kolkata`: Clarity **6** (2 scores · 2 learners), Confidence **6**
(1 score · 1 learner). Skill filter Clarity: 6 / 2 scores, Confidence card gone. Learner+Clarity: **8**
(1 score · 1 learner). Brightpath last 30 days in `America/Los_Angeles` (workspace “today” was 2 November):
Clarity **2** (1 score · 1 learner). A 3 November PT score is correctly excluded until that workspace day.
Personal clarity 10 does not appear in either organization report.

**Elevate (local override only).** Entitled on both fictional orgs. After `WORKSPACE_READY_OVERRIDE=replay,elevate`,
`POST /sessions` in Northwind is 201; Brightpath list length 0; Personal list does not contain the organization
session. Learner nav shows Elevate + Replay; Elevate page lists the Northwind session. No LiveKit room or
microphone yet.

**Interviews (local override only).** Walkthrough DB flags `interviews` / `interview_voice` / `interview_adaptive`
were unhidden in `spasht_walkthrough` only. After `WORKSPACE_READY_OVERRIDE=replay,elevate,interviews`,
`GET /api/interviews/options` is 200 in Northwind and 403 in Personal. Learner nav shows Interviews; the page
opens and reports no reviewed questions for this selection. No bank content and no microphone yet.

**Unfinished.** Feedback submission stays disabled (readiness false). Prepare and Coach stay off. Organization
readiness table is unchanged. No production feature is enabled.

## Blockers

- Elevate and Interviews still need a human microphone check (script in the walkthrough notes) before any
  production readiness flip.
- Feedback remains unfinished while organization readiness is false.
- Deployment needs explicit authorization in the Cursor conversation.
