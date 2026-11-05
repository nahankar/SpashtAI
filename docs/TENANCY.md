# Workspace tenancy implementation

Branch: `codex/multi-tenant-workspaces`, separate from the invitation/demo branch.
Base: `8e438a3`. No production changes or real invitations are part of this work.

## Agreed product contract

- Before accepting organization enrollment, an identity can use Personal. Accepted organization enrollment
  permanently makes that email tenant-only, with access to its organization memberships. Personal requires
  a different email. Existing Personal records and workspace rows are retained but unavailable to that identity.
- Existing root product routes remain Personal. `/w/:slug` selects an organization, never grants access.
- Tenant-only login goes to workspace selection; an organization entry retains its relative path through
  Google or email-code login/onboarding. Personal destinations are rejected for tenant-only identities.
- Platform administrators provision organizations. Workspace Owner/Admin privileges never change `User.role`.
- Organization features are constrained by platform availability, tenant entitlement, tenant configuration,
  member permissions and limits. Platform disable and membership suspension always win.
- Personal activity is never moved or exposed when an organization membership is created or accepted.
- A suspended/deleted organization membership does not remove the identity or retained Personal history,
  and does not restore Personal access. Pending invitations alone do not convert the identity.
- Workspace sessions are tab-local; no shared browser "current tenant" variable.

## Delivery boundaries

1. **Foundation (completed):** tenant/membership/feature/audit schema, Personal backfill, current-role
   platform administration, verified membership entry, membership acceptance, branding, feature delegation,
   safe path-based UI, short-lived workspace-only tokens, and two-tenant isolation checks.
2. **Data plane:** classify all models; migrate each enabled product's records, raw SQL, media access,
   LiveKit/WebSocket paths, worker jobs, analytics, local recovery and caches to a verified tenant boundary.
3. **Invitations (integrated, not deployed):** shared platform/workspace service, role/settings-bound atomic
   membership acceptance, RLS, shared mailer and tenant UI. Live Google and SMTP verification remain pending.
4. **Pilot:** owner and learners in two organizations plus Personal, real microphone/recording checks,
   then KLSVDIT onboarding once its Owner, logo, features and limits are supplied.

**Foundation is not product-data isolation.** Organization records are created in `FOUNDATION_ONLY` state.
No API in this checkpoint changes that state; organization product features always report unavailable.
The new UI does not mount existing Personal components or call global Admin analytics. Do not activate
organization practices by flipping a feature setting. That requires certification of each complete product data plane.

## Storage and authorization

`User` remains global. `Workspace` is either `PERSONAL` (one owner) or `ORGANIZATION`. `WorkspaceMember`
contains the organization-specific role/state. A private Personal workspace has exactly its identity as Owner.
Organization membership starts INVITED and must be accepted by that signed-in verified identity.

`WorkspaceFeature` defines platform-granted entitlement and tenant enablement separately.
`WorkspaceMemberFeature` holds optional per-member overrides; absence inherits the workspace default.
`WorkspaceAudit` is append-only through the application and retains content-free actions.

Foundation tables have PostgreSQL RLS. Queries establish actor/workspace context transaction-locally; no
request gets a persistent connection-level current tenant. The request role must be a non-owner/non-bypass
role for RLS enforcement; migration/admin credentials must not serve customer traffic. Integration tests
exercise actual policies with a restricted transaction role, not only the superuser fixture connection.

Global platform operations check the current User role and use an explicit audited control-plane path.
Workspace operations recheck current membership and workspace state. Tokens bind a user, membership and
workspace, expire after 15 minutes and are rejected by legacy Personal/Admin authorization. They cannot
be used to read old user-owned data under an organization label.

Placement metadata initially routes every workspace to the existing shared database. Dedicated placements
are reserved and fail closed; this checkpoint neither provisions databases nor opens arbitrary connections.
Later extraction must cover all data, queued work, object keys and rollback; a placement edit alone is unsafe.

## Parallel work and integration

Claude's checkout is unchanged. Its completed invitation branch through `81c393b` is merged into this
separate tenancy branch. The shared invitation service now supports workspace invitations; no duplicate
mailer or resolver exists. The Tenant Admin demo remains removed. See `INVITATIONS.md` for the API, policy
and verified boundaries. Initial Owner setup still requires a verified existing account.

## Parked follow-ups

After the tenancy decision, return to Feature Usage/UX timezone alignment and the Interviews reliability
microphone/privacy/release work. They are independent from enabling multi-tenant customer data.

## Session boundary checkpoint (implemented, not deployed)

Session and its five child tables now enforce immutable workspace ownership and RLS. Existing activity
stays Personal; legacy queries cannot see organization sessions. The optional read-only archive requires
`WORKSPACE_SESSION_ARCHIVE_ENABLED=true` as well as workspace rollout. It returns only the current
learner's content, even for tenant Owners/Admins. It does not create practices or enable voice.

Personal WebSocket subscriptions now require authentication and recheck ownership before broadcasts.
Deploy the web and server changes together when this branch is eventually approved for release.
Runtime credentials must enforce RLS; startup refuses unsafe roles when workspace mode is enabled or
organization sessions exist. Turning off the flag is not a substitute for a restricted runtime role.

See [Session contract](TENANCY-SESSION-CONTRACT.md), [complete model inventory](TENANCY-DATA-INVENTORY.md)
and [status](TENANCY-STATUS.md). Voice dispatch, storage upload/remote playback, workers, remaining product
roots, analytics, recovery/cache scoping and invitation integration still require implementation.

## Tenant-only account rollout (5 November 2026)

`20261105130000_tenant_only_accounts` adds `User.tenantOnly`, backfills accepted organization members
(including suspended accepted memberships and retained accepted invitations), and installs a membership
acceptance trigger. Conversion rolls back with enrollment; it never moves, deletes, or grants tenant admins
access to Personal history. Both public invitation acceptance and direct membership acceptance use this rule.

Deploy the migration and regenerate Prisma before releasing the API/web. Existing accepted tenant members
will lose Personal access when the new API is released; preserve the normal database backup before rollout.
The restriction survives membership suspension/removal and is not reset by Google, emailed codes, password
login or public signup. No application endpoint grants Personal access again.

The API guard reads current account state, including for old identity tokens and media query tokens.
Personal workspace entry and existing Personal workspace tokens are also rejected. Existing Personal
WebSocket subscriptions recheck on every event. Tenant workspace product scope and row isolation remain
required. Account/profile/sign-out, workspace control, public reference data and separately authorized
platform administration remain available. Legacy local Personal audio paths exclude converted owners.
UI entry, navigation, signup and login redirects use the same policy; Switch lists organization workspaces.
No Personal workspace is created by the chooser for tenant-only identities. Retained Personal reward points
are omitted from authentication responses.

Validation: 37 targeted account/navigation/email tests and 41 existing workspace/invitation/Elevate
API-authorization regression tests passed against the isolated PostgreSQL instance on port 55445.
For the latter, temporary test copies changed only 55443 to 55445 and were removed afterwards.
Production builds, frontend type checks and tenant-only mobile browser checks passed. Browser checks used
simulated API responses; database tests exercised actual restricted-role queries and retained history.
No production deployment, live email delivery or spoken voice-conversation run is claimed by these checks.

### Tenant member deletion

Tenant Users provides a Delete dialog with two explicit choices: remove membership and retain
history, or remove membership and delete tenant history. Admins may remove learners; Owners
may remove administrators. Users cannot delete themselves or remove the last active Owner.
`DELETE /api/workspaces/current/members/:memberId` requires `{ "history": "retain" | "delete" }`.
The operation serializes on the workspace row, revokes pending invitations for that tenant/email,
deletes membership and feature overrides, and appends a content-free audit in one transaction.
Old workspace tokens remain invalid even after re-enrollment, which creates a new membership ID.

History deletion targets only the removed member’s records in that organization. Sessions are
tombstoned for the existing durable cleanup worker (including active room shutdown); Replay and
feedback file references are queued in the durable file cleanup outbox before rows are deleted.
Preparation, coach, feedback, Pulse, usage and saved analytics history are deleted in that scope.
Other tenants, preserved Personal history, the shared email identity, billing/consent and audit
records remain intact. The email remains organization-only after removal. A new invitation is
required to regain tenant access.
