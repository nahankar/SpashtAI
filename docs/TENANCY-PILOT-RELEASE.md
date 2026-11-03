# Tenancy pilot release report

Stop: not merged, not deployed, production readiness flags unchanged.

## Release candidate

- **Candidate branch:** `tenancy-pilot-rc` (tenancy only; excludes Nova Sonic / agent greeting commit `95170b3`)
- **Working branch:** `codex/workspace-product-access` still contains `95170b3` as a separately reviewable inclusion
- Production revision: `origin/main` `d90bccf`
- Editor checkout `feature/tenant-admin-demo-invitations` @ `81c393b` was not reset
- Included organization products: Elevate, Replay, Interviews, Feedback, Progress Pulse
- Unfinished / unavailable in organizations: Prepare, Coach
- Production `WORKSPACE_FEATURE_READINESS`: still all `false` except `pro` / `ultra`
- Local walkthrough only: `WORKSPACE_READY_OVERRIDE=replay,elevate,interviews,feedback`

`95170b3` (Nova Sonic greeting / modalities / dotenv logging) is **not** part of this candidate. Include it only after a separate review.

## Review findings

| ID | Resolution |
| --- | --- |
| A | Read-only admin paths do not `FOR UPDATE` the Workspace row. Mutations use `scopedWrite`. |
| B | Interpret binds in a short transaction, calls the model outside, revalidates before return. |
| C | Platform overview practice totals are explicit `platform_practice_totals` aggregates with optional `?workspaceId=`. RLS stays on. |
| D | Recent leftovers return `409 VOICE_SESSION_ACTIVE`. Elevate and Interviews now show Cancel / **Take over this session**. Takeover closes leftover rooms via LiveKit `deleteRoom`, keeps leftover `audioStatus` pending so a late upload can finish, and first-close duration is immutable. Stale leftovers (≥6h) close as abandoned. |
| E | Due-only, ordered, keyset-paged discovery (50). `sweepLearnerAssessmentsEverywhere` now pages every due learner, not only the first page. |

## Passed automated checks

- Restricted-role DB: elevate (incl. takeover room release, late close, recording), interviews (incl. 51-scope pagination), admin analytics, product plane, isolation stress, invitations, session — 64 + 4 interview tests this run
- Web: live-session controller (Cancel and Take over), `voiceTakeover` wiring, api, `activeWorkspace`
- Isolated migrate deploy on `127.0.0.1:55443` `postgres` and `spasht_walkthrough` as owner; afterwards `tenancy_test_app` / `walkthrough_app` (`NOSUPERUSER`, `NOBYPASSRLS`) can call both `workspace_job_scopes(text)` and `workspace_job_scopes(text,text,text,int)`

## Acceptance — observed vs pending

Reuse Northwind Elevate mic `session_1793698728660_k17qya9k1` (Transcribe + Nova Lite + Polly, transcript, 71s WebM, Pulse tracked). Delivery alignment was still independently queued.

**Observed this pass (walkthrough API `:4100`, restricted `walkthrough_app`):**

- Same learner in Northwind, Brightpath and Personal
- Tenant admin `guide@walkthrough.test` is not a platform admin (`GET /api/admin/analytics/overview` → 403)
- Northwind session list contains the real mic session; Brightpath list is empty; Personal list does not contain the Northwind id
- Brightpath `GET` of the Northwind session id → 404; Brightpath recording stream → 404; Personal recording stream → 404; Northwind stream → 200
- Interviews options 200 in Northwind and Brightpath (fictional bank coverage 3); Personal → 403

**Not observed — remaining human blockers:**

1. Brightpath Elevate microphone, saved transcript, recording/playback
2. One real local Interview against the fictional bank: live transcript under Show conversation, progression, recording/playback, technical feedback only after End, isolation of that run from Personal/Northwind/Brightpath

Do not treat those as complete until they are run.

## Tenant onboarding

Still configuration only: name, slug, branding, timezone, limits; verified Owner assignment (`OWNER_ACCOUNT_REQUIRED`); entitlements; enrollment/invitation copy; user invitations. No per-tenant code or migration.

## Pending production migrations

From production revision `d90bccf`, apply **all** of these once as the migration/owner role (not the runtime role):

1. `20261103090000_workspace_product_plane` — RLS, placement, manager reader, job-scope function (this is the isolation cutover)
2. `20261103120000_pilot_review_fixes` — due-only 4-arg `workspace_job_scopes`, `platform_practice_totals`
3. `20261103150000_workspace_job_scopes_compat` — 1-arg wrapper for a previous application revision
4. `20261103160000_workspace_job_scopes_unambiguous` — 4-arg form without defaults so the wrapper is not ambiguous

Foundation through enrollment (`20261101120000` … `20261102190000`) is already on `origin/main`.

**Upgrade**

1. Backup. Drain live Elevate/Interview rooms if the product-plane migration is pending.
2. Run `prisma migrate deploy` **once** with owner/migration credentials.
3. Deploy the matching application revision (`tenancy-pilot-rc`).
4. Confirm the API process uses the restricted runtime role (`NOSUPERUSER`, `NOBYPASSRLS`). `/ready` must succeed under that role.
5. **Admin-shell smoke (readiness still off):** create org, assign verified Owner, invitations, users, feature settings. Learners see no organization products.
6. **Product smoke (only after an explicit readiness flip in product code plus entitlements):** Elevate/Replay/Interviews/Feedback/Pulse in entitled orgs only.

Code readiness is global (`WORKSPACE_FEATURE_READINESS`). Entitlements decide which organizations receive a ready product. Tenant settings cannot turn readiness on.

## Rollback

Dropping functions while the new application is live is not a rollback. Compatible steps:

1. Redeploy the previous application revision first (it must not call `platform_practice_totals` or the 4-arg worker pagination).
2. The 1-arg `workspace_job_scopes(text)` wrapper remains so that previous worker discovery can start.
3. Only then optionally restore older function bodies. Do not drop the 4-arg form or `platform_practice_totals` while `tenancy-pilot-rc` (or later) is running.
4. After organization activity exists, do **not** roll back `20261103090000_workspace_product_plane`.

## Remaining defects vs deferred

- Delivery alignment / Gentle completion is an independent worker path
- Prepare and Coach stay unfinished in organizations
- First Owner still requires a verified account
- Brightpath Elevate mic/playback and a real Interview run are **pending observation**
- Nova Sonic agent commit is excluded from this candidate

## Production smoke checklist

**Admin shell (readiness off)**

1. Backup; migrate as owner; deploy app; confirm restricted runtime.
2. Platform Admin: create scratch org (config only), assign verified Owner, entitle nothing yet.
3. Owner (not platform admin): users, invitation, revoke, feature toggle. No learner products visible.

**Products (readiness on + entitlements only)**

4. Entitle Elevate/Replay/Interviews/Feedback/Pulse on the scratch org.
5. Learner: Personal Elevate still works; org nav shows only ready entitled products.
6. Cross-workspace: known session id, recording URL, and subscription from the other org fail closed.
7. Platform overview: `scope.practice` is `all-workspaces`; `?workspaceId=` narrows; tenant admin cannot call platform analytics.
8. Start Elevate twice: Cancel leaves the first take; Take over ends the first LiveKit room, keeps duration, and allows the old tab’s recording to finish.
