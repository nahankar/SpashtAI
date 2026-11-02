# Tenancy implementation status

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

Final checks: 594 server tests passed (124 database/optional checks skipped); all 325 web tests passed.
Server/web type checks, changed-file web lint, the production build and schema validation passed.
The tenancy integration tests are included in the 594 and run against the restricted real database role. No production changes.

- Fresh baseline plus all migrations applied to a dedicated local PostgreSQL container (port 55443).
- Independent upgrade check seeds an existing learner/session before the migration and verifies Personal ownership survives.
- API/database checks use a NOSUPERUSER NOBYPASSRLS role, not the fixture superuser.
- Browser walkthrough uses only fictional local accounts: platform setup, Personal/organization choices,
  pending membership and self-acceptance, organization overview and disabled product access.

## Remaining before KLSVDIT learner access

1. Classify every product table and derived record, then add workspace ownership and composite references.
   This includes sessions, conversations, recordings, segments, Replay, Prepare, Interviews, scores, feedback and usage.
2. Replace implicit global user ownership in every applicable API/raw SQL query, signed media URL, upload,
   LiveKit room/dispatch/agent call, WebSocket subscription, cache key, job payload and browser recovery key.
   Add two-organization + Personal leakage tests at each boundary. Enable products individually only after verification.
3. Integrate Claude's finished invitation service: target workspace, proposed role/settings, verified email,
   expiration/revocation, atomic membership creation/acceptance, resend fencing and audit/retention.
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
