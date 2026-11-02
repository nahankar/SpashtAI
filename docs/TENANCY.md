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

1. **Foundation (this checkpoint):** tenant/membership/feature/audit schema, Personal backfill, current-role
   platform administration, verified membership entry, membership acceptance, branding, feature delegation,
   safe path-based UI, short-lived workspace-only tokens, and two-tenant isolation checks.
2. **Data plane:** classify all models; migrate each enabled product's records, raw SQL, media access,
   LiveKit/WebSocket paths, worker jobs, analytics, local recovery and caches to a verified tenant boundary.
3. **Invitations:** integrate the completed invitation service from Claude's branch, recording target tenant,
   role and member settings and creating membership atomically with acceptance. No duplicate mailer here.
4. **Pilot:** owner and learners in two organizations plus Personal, real microphone/recording checks,
   then KLSVDIT onboarding once its Owner, logo, features and limits are supplied.

**Foundation is not product-data isolation.** Organization records are created in `FOUNDATION_ONLY` state.
No API in this checkpoint changes that state; organization product features always report unavailable.
The new UI does not mount existing Personal components or call global Admin analytics. Do not activate
organization practices by flipping a feature setting. That requires checkpoint 2.

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

Do not edit Claude's checkout, invitation files, email service, Google identity resolver or demo components.
Shared App/index/schema/sidebar changes will require a normal reviewed merge. Membership invitation email
is deliberately not implemented in a second service. Existing-user membership invitations in the foundation
are visible in the signed-in workspace list, with no claim that an email was sent.

## Parked follow-ups

After the tenancy decision, return to Feature Usage/UX timezone alignment and the Interviews reliability
microphone/privacy/release work. They are independent from enabling multi-tenant customer data.
