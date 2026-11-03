# Tenancy pilot release report

Stop: not merged, not deployed, production readiness flags unchanged.

## Revision and products

- Branch: `codex/workspace-product-access`
- Worktree: do not reset the editor checkout (`feature/tenant-admin-demo-invitations` @ `81c393b`)
- Included organization products: Elevate, Replay, Interviews, Feedback, Progress Pulse
- Unfinished / unavailable in organizations: Prepare, Coach (Personal `/coach` only)
- Production `WORKSPACE_FEATURE_READINESS`: still all `false` except `pro` / `ultra`
- Local walkthrough only: `WORKSPACE_READY_OVERRIDE=replay,elevate,interviews,feedback`

## Review findings

| ID | Finding | Resolution |
| --- | --- | --- |
| A | `withWorkspaceAccess` exclusively locked Workspace on report reads | Reads no longer take `FOR UPDATE`. Mutations use `scopedWrite` / `withLockedWorkspaceAccess`. Suspend/revoke still rechecked on every request; writes serialize on the Workspace row so a waiter re-reads membership after the lock. |
| B | AI Analytics waited for Bedrock inside the workspace transaction | Bind learner + authorize in a short transaction, call the model outside, revalidate membership/role before returning the plan. |
| C | Platform user counts were global; practice queries saw only Personal | Overview now returns `scope: { kind: 'platform', workspaceId, practice }` and practice totals from `platform_practice_totals` (SECURITY DEFINER, platform-admin flag required). Optional `?workspaceId=`. RLS is not disabled. |
| D | Silent close of other open sessions | Recent leftovers return `409 VOICE_SESSION_ACTIVE`. Stale leftovers (updatedAt ≥ 6h, same as voice occupancy) close as abandoned. Explicit `takeover: true` ends a recent leftover with duration accounting. |
| E | `workspace_job_scopes` returned 200 unsorted rows including not-due work | Due-time filters, `ORDER BY (workspaceId, userId)`, keyset pagination (50/page). Retrying jobs leave the due set until `nextAt`. |

## Passed checks

- Restricted-role DB tests: workspace elevate, admin analytics, product plane, isolation stress, invitations, session (99 passed in those files this run)
- Web: `activeWorkspace`, live-session api/controller
- Migration `20261103120000_pilot_review_fixes` applied to isolated `127.0.0.1:55443` `postgres` (test) and `spasht_walkthrough` only. Not applied to production.

## Reused walkthrough evidence (not re-run)

- Two fictional orgs (Northwind, Brightpath) + Personal; same learner in both; tenant admin ≠ platform admin
- Entry/switch/refresh, fail-closed product headers, Feedback path
- Northwind Elevate mic `session_1793698728660_k17qya9k1`: Transcribe + Nova Lite + Polly, transcript saved, 71s WebM on the Northwind prefix, Pulse tracked (5 Northwind rows). Session-level WPM unscored: both turns below the 8-word / 4-second bar. Delivery alignment was still `pending` at inspection — queued banner is honest; do not treat the HTTP 200 results page as completed alignment.
- Replay/Pulse honesty and Interview fictional bank were previously verified locally.

## Tenant onboarding

Creating another organization is configuration only:

1. Platform Admin: name, slug, branding, timezone, limits
2. Assign a **verified** SpashtAI account as Owner (`OWNER_ACCOUNT_REQUIRED` if missing). Single-step “create and invite Owner” is deferred.
3. Entitlements / enablement / member defaults
4. Enrollment fields and invitation message
5. User invitations

No per-tenant code, migration, subdomain, or database.

## Remaining defects vs deferred

- Delivery alignment / Gentle completion is an existing independent worker path; not part of this pilot gate.
- Prepare and Coach stay unfinished in organizations.
- Platform Admin explorer/detail reports still do not dump raw org transcripts (intentional).
- First Owner must already have a verified account.
- Voice-model / Nova Sonic greeting changes are a separate commit and not required for the Transcribe + Nova Lite + Polly tenant path.

## Migration, backup, rollback

- New migration only adds/replaces SQL functions. No table rewrite.
- Backup the production database before deploy. Rollback of the function change is `DROP FUNCTION` + restore the previous `workspace_job_scopes(text)` definition.
- After organization activity exists, do **not** roll back tenancy foundation migrations (workspace columns, RLS). Function-only rollback remains possible.

## Proposed production enablement (not applied)

Do not flip until a separate deploy authorization. Suggested first production entitlements, still behind `WORKSPACE_FEATURE_READINESS`:

- Keep all readiness flags `false` on first deploy (admin shell only).
- After smoke: set readiness `true` only for `elevate`, `replay`, `interviews`, `feedback`, `progress_pulse` in product code — never via tenant settings.

## Production smoke checklist

1. Backup; confirm no long-running Elevate/Interview rooms you cannot drain.
2. Deploy API + web; apply `20261103120000_pilot_review_fixes` as the runtime role (NOSUPERUSER, NOBYPASSRLS) after migrate as owner.
3. Platform Admin: create a scratch org (config only), assign verified Owner, entitle one product (still hidden if readiness is false).
4. Owner: users, invitation, revoke, feature toggle.
5. Learner: Personal Elevate still works; org nav shows only ready entitled products.
6. Cross-workspace: known session id, recording URL, and subscription from the other org all fail closed.
7. Platform overview: `scope.practice` is `all-workspaces`; `?workspaceId=` narrows totals; tenant admin cannot call platform analytics.
8. Start Elevate twice: second start without takeover is 409; takeover ends the first take with duration.
