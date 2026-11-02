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
| 2 | Elevate voice: agent scope, callbacks, live updates, media, workers, voice concurrency | No | No |
| 3 | Replay: uploads, storage keys, processing, playback, export, deletion | No | No |
| 4 | Interviews: runs, attempts, evaluator workers, tenant evaluation budget | No | No |
| 5 | Workspace admin APIs: dashboard, users, invitations, feedback, usage, Pulse, AI Analytics, settings | No | No |
| 6 | Web shell `/w/:slug`, role navigation, workspace header, namespaced browser storage | No | No |
| 7 | Prepare/Coach readiness (isolated at the data level; not offered) | Data only | Data only |
| 8 | Docs, review, push; deployment only after authorization | No | No |

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

## Known gaps and decisions

- Platform Admin analytics run without a workspace context and therefore show Personal activity only. Organization
  analytics belong to the workspace admin pages (checkpoint 5).
- Flaky: `workspace-invitations-database` bulk test failed once in four full runs (platform bulk mailbox shared across
  parallel files). Not caused by isolation changes; tracked.

## Blockers

None. Deployment needs explicit authorization in the Cursor conversation.
