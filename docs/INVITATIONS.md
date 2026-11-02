# Learner invitations

Platform Admins (ADMIN / SUPER_ADMIN, rechecked in the database on every request) can invite a person to
SpashtAI by email. Invitations are available from **Admin → Dashboard** (invitation counts, pending table and
Invite user), **Admin → Users** and **Admin → Invitations**. All use the same server
service (`apps/server/src/lib/invitations.ts`). Before sending, the confirmation states plainly that a real
invitation email goes to the recipient (or, in development, that it is captured locally and not sent).

## Scope of this release

- Recipients join as ordinary learners (`USER`). An invitation can never grant ADMIN or SUPER_ADMIN; any role
  sent by a client is ignored.
- The platform Admin endpoints create **platform invitations**, with no workspace or membership assigned.
  They list/count/manage only null-scope invitations. Separate workspace endpoints reuse this service for
  organization membership; see "Tenancy integration" below.
- Accepting requires Google sign-in. Gmail, Google Workspace and other addresses registered as a Google Account
  all work; we never judge this from the email domain. Email-code / magic-link sign-in is not implemented.

## Policy exception: invitations bypass paused signups

**Yes — a valid invitation bypasses paused public signups.** This is a deliberate, product-approved exception.
While "Pause signups" is on, the invited address can still create an ordinary learner (`USER`) account, but only:

- through invitation acceptance (`POST /api/invitations/accept`), never through `/api/auth/register` or
  `/api/auth/google`, which stay blocked;
- for a pending, unexpired, unrevoked invitation, checked under the row lock;
- with a verified Google identity whose email exactly matches the invited address.

Onboarding and terms stay mandatory. Every bypass is audited without content (`signupsPausedBypass: true` on
the `invitation_accepted` UserActivity and AdminAction rows). The Users page (Registration card) and the
Invitations page both state this exception.

## Flow

1. Admin enters an email (and optionally a name), reviews the confirmation and sends.
   - One pending invitation per address (`409 duplicate_pending`; use Resend).
   - An address that already has an account needs a second confirmation (`409 existing_user`).
2. The branded email has an **Accept invitation** link: `FRONTEND_URL/invite#token=…`. The token is in the URL
   fragment, so it never reaches server or proxy logs.
3. The recipient signs in with Google. The verified Google email must equal the invited address; otherwise the
   page says **Switch Google account**, shows the full invited address to the link holder, and nothing changes.
4. Account handling reuses normal Google sign-in (`lib/googleSignIn.ts`):
   - Existing account: signed in; role, permissions, flags and history are unchanged; no duplicate is created.
   - New account: created as `USER`, then the normal profile/terms onboarding runs. This works even while
     signups are paused, but only for a pending, unexpired, unrevoked invitation accepted through this flow
     with the exact verified invited address. Every other signup (register, `/api/auth/google`) stays blocked.
     The bypass is audited without content as `UserActivity` `invitation_accepted` with metadata
     `{ newAccount: true, signupsPausedBypass: true }`.
5. Accepting again with the same account is idempotent.
6. **Atomic acceptance** (`lib/invitationAcceptance.ts`): after the Google credential is verified, one database
   transaction locks the invitation row, re-checks token, address, status and expiry, resolves or creates the
   account, marks the invitation accepted and writes both audit rows. Any failure (including audit
   persistence) rolls all of it back, so no account is ever created and then deleted, and an acceptance never
   exists unaudited. Revoke and resend update the same row, so they either wait for an acceptance (and then
   refuse) or win first (and the acceptance sees a revoked invitation or a superseded link). A normal Google
   sign-in racing the acceptance for the same address hits the unique email/Google ID constraint; the losing
   transaction retries and finds the account instead of duplicating it. Retries are safe.

## Statuses and safeguards

- Invitation status: `pending`, `accepted`, `expired` (derived from `expiresAt`), `revoked`.
- Delivery status is separate: `SENT` (accepted by the mail server — not proof of inbox delivery), `FAILED`
  (invitation stays pending; fix email and Resend), `DEV_CAPTURED` (local only, nothing sent).
  Each send attempt is fenced by its own token: an outcome is recorded only while that attempt's token is still
  current, so an older send finishing after a resend cannot overwrite the newer status. Attempts are counted
  (`sendCount`, `lastSentAt`) when they start; audit rows keep each attempt's own outcome with a `superseded` flag.
- Tokens: 32 random bytes, stored only as SHA-256, single use. **Resend** issues a new token and expiry, so the
  previous link stops working. **Revoke** stops the link; accepted invitations cannot be revoked.
- Expiry: `INVITATION_EXPIRY_DAYS` (1–30, default 7).
- Audit: `AdminAction` rows `invitation_create`, `invitation_resend`, `invitation_revoke` with
  `targetResource = invitation:<id>` and content-free metadata (no email, name or token). Each is written in the
  same transaction as its state change: if the audit write fails, nothing is created, re-tokened or revoked, and
  no email is sent. Resend locks the row and reads its own token, expiry and attempt number back inside that
  transaction, so concurrent resends never share or swap metadata. SMTP runs after the transaction commits; each
  attempt's outcome is then written with an `invitation_delivery` row (`attempt`, `deliveryStatus`, `superseded`)
  in one short transaction fenced to that attempt's token. If only that last write fails, the invitation stays
  committed with delivery status Sending, and the Admin is told the outcome was not recorded.
  Acceptance is recorded both as `UserActivity` `invitation_accepted` and as an `AdminAction`
  `invitation_accepted` attributed to the inviting Admin (`targetUserId` = the account, `targetResource` =
  `invitation:<id>`, metadata `{ actor: 'recipient', newAccount, signupsPausedBypass }` only).
- Rate limits (production): 60 sends/resends per Admin per hour; 20 lookups/acceptances per IP per 15 minutes.

## Email configuration

Production sends through the existing SMTP service (`lib/email.ts`). Required on the API server:

| Variable | Purpose |
| --- | --- |
| `SMTP_HOST` | SMTP server host |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `FRONTEND_URL` | Public web origin used in the accept link (e.g. `https://spasht.ai`) |

Optional: `SMTP_PORT` (default 587; 465 uses TLS), `SMTP_FROM` (default `noreply@spashtai.com`),
`INVITATION_EXPIRY_DAYS` (default 7). If any required value is missing, invitations are saved with delivery
`FAILED / smtp_not_configured`, and the Invitations page lists the missing variable names (never values).

To check a server's setup without exposing anything, run from `apps/server` with its env loaded:
`npx tsx scripts/check-invitation-email.ts`. It prints only which variables are set, then verifies the SMTP
connection and login without sending mail. `--send-test <address>` additionally sends one plain test message
(not an invitation) to that address only.

Outside production (`NODE_ENV !== 'production'`) invitations are **captured in memory and not sent**, unless
`INVITATION_EMAIL_DELIVERY=smtp` is set explicitly. Captured messages appear on the Invitations page under
"Captured invitation emails (development only)" and at `GET /api/admin/invitations/dev-mailbox`.

Production always uses SMTP: `INVITATION_EMAIL_DELIVERY=capture` is refused there (logged at startup and
reported as `captureRefused` by `email-config`), and the dev mailbox endpoint returns 404 in production.

## Retention and deletion

- **Purge:** an hourly sweep per API process (`startInvitationRetentionWorker`, same pattern as the evaluator
  budget cleanup) deletes closed invitations, including their email and name, once they are older than
  `INVITATION_RETENTION_DAYS` (30–730, default 90): accepted ones by acceptance date, revoked ones by
  revocation date, expired ones by expiry date. Pending invitations are never purged.
- **User deletion:** when an Admin deletes a user (`DELETE /api/admin/users/:id`), every invitation for that
  address or accepted by that account is deleted in the same transaction. The `user_deleted` audit row records
  only how many invitations were removed.
- Audit rows (`AdminAction`) contain no email, name or token, so they are kept under the existing audit rules.

## API

Admin (`requireAuth` + `requireCurrentAdmin`):

- `GET /api/admin/invitations?status=pending|accepted|expired|revoked&q=&page=&pageSize=` → items, total,
  pagination and per-status counts
- `POST /api/admin/invitations` `{ email, name?, confirmExistingUser? }`
- `POST /api/admin/invitations/:id/resend`, `POST /api/admin/invitations/:id/revoke`
- `GET /api/admin/invitations/email-config`, `GET /api/admin/invitations/dev-mailbox`

Public: `POST /api/invitations/lookup` `{ token }`, `POST /api/invitations/accept` `{ token, credential }`.

## Tenancy integration (implemented on the tenancy branch; not deployed)

`codex/multi-tenant-workspaces` incorporates the reviewed invitation branch through `81c393b`.
The Tenant Admin demo stays removed. Real organization controls live under `/w/:slug`, never the global Admin pages.

- `UserInvitation.workspaceId = null` preserves platform invitations. Organization invitations have an immutable
  workspace ID, proposed OWNER/ADMIN/LEARNER role, inviter and member-feature overrides. Pending keys include
  the workspace and normalized email, so one identity can have separate invitations to several organizations.
- Both kinds share token generation, expiry, captured/SMTP delivery, resend snapshots and per-attempt fencing.
  No second mailer or Google account resolver exists. SMTP executes only after state/audit commit.
- Workspace endpoints require workspace JWTs, active membership and current role. Owners may invite
  administrators; Admins may invite/manage only learners. Learners cannot list invitation recipients.
  Every query has explicit workspace predicates, additionally enforced by RLS. Platform endpoints explicitly
  exclude organization invitations, even when run using privileged fixture credentials.
- Acceptance uses a transaction-local token hash to access exactly the intended organization invitation.
  It locks the workspace before the invitation, checks expiry/revocation and verified Google email, resolves
  the account, then rechecks current inviter permissions, membership suspension, seat capacity and feature
  entitlements. Account, membership, feature overrides, invitation and WorkspaceAudit commit together.
  Failure rolls back any new identity. Accepted links do not restore suspended memberships or overwrite roles.
- Active memberships cannot be reinvited or silently promoted; manage them through the member controls.
  Existing provisional memberships must agree with the invitation's role. Personal records and `User.role`
  remain unchanged. Acceptance redirects to `/w/:slug`, preserving that destination through profile onboarding.
- Pending email invitations reserve seats, excluding duplicate reservations for existing non-suspended
  provisional members. All membership/seat mutations serialize on the workspace lock; acceptance rechecks
  actual membership capacity. Suspension blocks sending/acceptance and preserves pending links until expiry
  or explicit revoke; reactivation restores their validity if otherwise permitted. Deleting a workspace cascades
  its invitations. Inviter suspension/demotion blocks outstanding grants that they can no longer authorize.
- **Signup policy:** the approved paused-signup bypass remains exclusive to platform invitations. Organization
  invitations do not bypass paused public signups for new identities. Existing accounts may still join.
- Tenant actions use WorkspaceAudit, not a pretend platform AdminAction attributed to a tenant Admin.
  Narrow maintenance SQL functions purge closed PII after the configured retention floor and delete all
  invitations for an account in the same account-deletion transaction. Account cleanup requires current
  platform Admin context. Functions return counts only; they do not expose recipient records.
- Tenant UI shows invitation counts, a paginated status list, confirmation, role/initial feature permissions,
  resend/revoke and truthful delivery status. It does not expose SMTP settings or captured acceptance links.
  Platform development capture lists exclude all organization invitations.

Workspace API (default-off `WORKSPACES_ENABLED`, restricted runtime role required):

- `GET /api/workspaces/current/invitations?status=pending|accepted|expired|revoked&page=1` (20 per page)
- `POST /api/workspaces/current/invitations` `{ email, name?, role?, memberFeatures? }`
- `POST /api/workspaces/current/invitations/:id/resend`
- `POST /api/workspaces/current/invitations/:id/revoke`

The public lookup/accept endpoints remain shared. Acceptance additionally returns `workspacePath` for an
organization invitation. It is not a membership capability: entering the path rechecks current membership.

**Still pending:** real Google browser acceptance, production SMTP configuration/login/delivery, and creating
an organization's initial Owner by email before they have an account. Initial provisioning currently retains
its verified-existing-Owner requirement. Organization practices and tenant analytics remain disabled until
those data planes are certified. Email-code / magic-link sign-in is not implemented.
