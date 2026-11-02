# Workspace tenancy implementation

Branch: `codex/multi-tenant-workspaces`, separate from the invitation/demo branch.
Base: `8e438a3`. No production changes or real invitations are part of this work.

## Agreed product contract

- One verified login identity may have one private Personal workspace and multiple organization memberships.
- Existing root product routes remain Personal. `/w/:slug` selects an organization, never grants access.
- Root login goes to Personal; a workspace entry retains its relative path through Google login/onboarding.
- Platform administrators provision organizations. Workspace Owner/Admin privileges never change `User.role`.
- Organization features are constrained by platform availability, tenant entitlement, tenant configuration,
  member permissions and limits. Platform disable and membership suspension always win.
- Personal activity is never moved or exposed when an organization membership is created or accepted.
- A suspended/deleted organization membership does not remove the global identity or Personal history.
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
