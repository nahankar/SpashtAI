# Tenancy implementation status

Current production status: reviewed control-plane release deployed November 2, 2026 (code `cd2acd5`); production
is now `d90bccf`. See `TENANCY-RELEASE-2026-11-02.md`.

**Organization product plane (November 3, 2026):** branch `codex/workspace-product-access`. Data isolation,
Elevate/Replay/Interviews organization paths, workspace admin APIs/pages and the `/w/:slug` shell are implemented
and tested. Local walkthrough now also has a published fictional Interview bank, fail-closed organization client
helpers, and a finished Feedback path enabled only via `WORKSPACE_READY_OVERRIDE`. `WORKSPACE_FEATURE_READINESS`
is still `false` for those products in product code. Prepare and Coach stay unfinished. Not human-verified with
Google or a microphone. Not merged or deployed. Progress, evidence and release gates:
[TENANCY-PRODUCT-PLANE.md](TENANCY-PRODUCT-PLANE.md).

Earlier checkpoint notes below describe their status at the time.

Branch: `codex/multi-tenant-workspaces` from `8e438a3`.
Worktree: `VI/worktrees/spashtai-tenancy`. Separate from Claude's invitation/demo checkout.

## Implemented foundation

- Reusable organization creation under platform Admin → Workspaces. New organizations use `/w/:slug`.
- One global identity, private Personal membership and multiple organization memberships.
- Verified-account membership proposals and self-acceptance. No duplicate email service or real emails.
- Organization Owner/Admin/Learner roles, current membership checks, suspension/reactivation and active-Owner protection.
- Tenant name, inline logo, accent and time zone; limits and platform entitlements; tenant defaults and member overrides.
- PostgreSQL RLS on five foundation tables, transaction-local context, workspace-bound expiring access tokens.
- Restricted database role and installed RLS required before any workspace API serves requests.
- Personal activity remains user-owned. No product history is moved into organizations.
- Workspace UI uses a fresh document on workspace switches, excludes Personal engagement telemetry and diagnostics,
  and never mounts global product history or Admin analytics under an organization label.
- Organization product access is deliberately unavailable, even when settings allow a feature.

## Validation

Foundation checkpoint checks: 594 server tests passed (124 database/optional checks skipped); all 325 web tests passed.
Server/web type checks, changed-file web lint, the production build and schema validation passed.
The tenancy integration tests are included in the 594 and run against the restricted real database role. No production changes.

- Fresh baseline plus all migrations applied to a dedicated local PostgreSQL container (port 55443).
- Independent upgrade check seeds an existing learner/session before the migration and verifies Personal ownership survives.
- API/database checks use a NOSUPERUSER NOBYPASSRLS role, not the fixture superuser.
- Browser walkthrough uses only fictional local accounts: platform setup, Personal/organization choices,
  pending membership and self-acceptance, organization overview and disabled product access.

## Session and recording checkpoint (November 2)

- All 62 schema models classified in `TENANCY-DATA-INVENTORY.md`.
- Session plus transcript/metrics/segment/turn/recording ownership is immutable and protected by forced RLS.
- Safe, learner-only archive metadata/transcript/local audio routes behind a separate default-off gate.
- Namespaced media keys, byte ranges, foreign-path/symlink rejection and current membership checks.
- Personal live updates require authenticated ownership, including revalidation before each broadcast.
- Unsafe runtime database roles rejected; unscoped product links to organization sessions rejected.
- Existing-session upgrade/backfill verified, including accounts that never opened the workspace chooser.

Validation: 629 server tests passed (124 optional checks skipped), 325 web tests passed. Build, type checks
and changed-hook lint passed. Real restricted-role database/API tests and a local WebSocket network
test cover two organizations plus Personal. One initial full-suite integration timeout did not recur on
the full repeat; no timeout was increased. Upgrade verification confirms eleven tables enforce RLS.

This is an API/database checkpoint: there is no archive player UI, remote-object playback or organization
practice creation. Raw content remains private to its learner. No production data or real invitations used.

## Invitation integration checkpoint (November 2)

Integrated Claude's final platform invitation branch through `81c393b` in this worktree. Reviewed fixes for
transactional audit, locked resend snapshots, signup-policy pool usage and demo removal are retained.

- Organization-bound email invitations, proposed roles and initial member feature settings.
- Current Owner/Admin permission checks, workspace-only lists/counts/actions and forced invitation RLS.
- Atomic account/membership/acceptance/audit; inviter, suspension, expiry, seats and entitlements rechecked.
- Shared mailer, token handling, resend fencing, platform behavior and production SMTP safeguards preserved.
- Tenant invitation screen with counts, confirmation, paginated lists and truthful delivery status.
- Workspace return path retained after acceptance/onboarding; Personal history and platform roles unchanged.
- Bounded retention and platform-authorized account deletion include organization invitation PII.

Validation: 675 server tests passed, 124 optional tests skipped; 332 web tests passed. Build/type checks pass.
Upgrade from existing records preserves Personal sessions/transcripts and null-scope platform invitations;
twelve tables enforce RLS. Real restricted-role HTTP tests cover cross-workspace access, role restrictions,
rollback on failed audit and competing final-seat acceptance. Local browser checks use fictional identities
and captured mail for create/resend/revoke; no real emails sent. Google verification is mocked in API tests;
real Google acceptance and production mail delivery remain pending. No merge to main or deployment.

## Remaining before KLSVDIT learner access (November 2 list; items 1, 2, 4, 5 and 6 are now implemented on the product-plane branch)

1. Extend the completed model inventory and Session aggregate boundary to the remaining product roots.
   This includes Replay, Prepare, Interviews, scores, feedback and usage.
2. Replace implicit global user ownership in every applicable API/raw SQL query, signed media URL, upload,
   LiveKit room/dispatch/agent call, WebSocket subscription, cache key, job payload and browser recovery key.
   Add two-organization + Personal leakage tests at each boundary. Enable products individually only after verification.
3. Finish invitation production readiness: real Google acceptance, SMTP setup/delivery checks, and optional
   email-based initial Owner provisioning. The shared service integration is implemented.
4. Implement tenant-only Dashboard/analytics, including learner selectors and day-wise usage. Do not reuse
   platform Admin routes or rely on a hidden sidebar for isolation.
5. Enforce configured evaluation/concurrency quotas in product services. Configured values are not yet execution limits.
6. Add cursor pagination before organizations or member rosters exceed this foundation UI's first 100 rows.
7. Complete account lifecycle/retention, export/deletion, workspace suspension cleanup for running jobs,
   backup/restore and dedicated-database placement routing. Dedicated placements currently fail closed.
8. Run the real browser/microphone pilot with two organizations and Personal. Then provision KLSVDIT with
   its approved Owner, name/logo, entitlements, limits and invitation list.

## Integration notes for Claude

Continue your invitation/demo work in your own checkout. Do not reset or switch this worktree.
Shared integration files: Prisma schema, API index, App routes, Admin sidebar, safe login return paths,
legacy Admin user deletion error handling and telemetry exclusions. Review merges normally.
`User.role` remains platform-wide. Never promote a workspace Admin to global ADMIN.
The account-deletion migration prevents deleting an organization's last Owner; transfer ownership first.
The email integration should extend the existing invitation service, not replace it with this foundation's
existing-account-only enrollment helper.

## Deployment boundary

Do not merge/deploy this as complete tenancy. `WORKSPACES_ENABLED` defaults to false. Migrations require
separate migration credentials. The running API must use a role without SUPERUSER/BYPASSRLS and have grants
on the new tables; the API checks enforcement on every workspace request. Workspace migration functions
are installed by a privileged migrator, with a fixed search path and no public execute grant.

KLSVDIT has not been created in production. Main, EC2 and Claude's working tree are not changed by this branch.

## Reproduce local checks

Use the dedicated `spasht-tenancy-test` PostgreSQL container on `127.0.0.1:55443`, never the development
or production database. Initialize an empty database using the existing baseline script, then apply all
migrations using migration credentials. The integration test creates its own restricted test-only role
and fictional identities; it cleans up identities/organizations after running.

From the repository root:

```sh
WORKSPACE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55443/postgres npm --workspace apps/server test
WORKSPACE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55443/postgres node apps/server/scripts/verify-workspace-migration.mjs
npm --workspace apps/web run typecheck
npm run build
```

API contract: `docs/api/workspaces.openapi.json`. No Postman/cloud publishing is needed to use it.

## Reviewed control-plane release (November 2)

The user authorized merging and EC2 deployment of the control plane; this is not approval to enable tenant
practices or analytics. The release enables workspace administration only after twelve forced-RLS tables
and a non-owner/non-bypass runtime role are installed. Archive remains off and product readiness stays false.

Release review fixed environment initialization order, cross-user conversation mutation/search, secret-link
logging and SMTP transport safeguards, and transactional account-deletion audit. Regression checks: 679 server
tests passed (124 optional skipped), 332 web tests passed; build/type checks and deployment shell syntax pass.
The restricted-role helper was exercised twice against the isolated database. It keeps migration credentials
in a separate mode-600 deployment file and verifies runtime privileges before replacing the API env file.

Deployment uses a verified PostgreSQL archive backup, stops API/agent for pending migrations, preserves
production overlays, and installs restricted runtime credentials before restarting. Never bypass the active
voice-session guard or enable organization products to make a deployment pass.

SMTP sender is `info@spasht.ai`; messages state replies are not routinely monitored. Zoho's exact account
server and app password must be entered in production `apps/server/.env`; secrets are never committed.
Real Google acceptance and email delivery remain human/provider checks, separate from local test identities.

## Workspace invitation enrollment — 3 November 2026

Workspace-specific form fields, custom email messages and private bulk invitation delivery are implemented. See [signup and invitation guide](WORKSPACE-SIGNUP-AND-INVITATIONS.md) for validation, limits and behavior. Product-plane isolation remains unfinished; these changes do not enable organization practices or analytics.
