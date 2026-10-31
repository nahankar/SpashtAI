# Learner invitations

Platform Admins (ADMIN / SUPER_ADMIN, rechecked in the database on every request) can invite a person to
SpashtAI by email. Invitations are available from **Admin → Dashboard** (invitation counts, pending table and
Invite user), **Admin → Users**, **Admin → Invitations**, and the Tenant Admin demo. All use the same server
service (`apps/server/src/lib/invitations.ts`). Before sending, the confirmation states plainly that a real
invitation email goes to the recipient (or, in development, that it is captured locally and not sent).

## Scope of this release

- Recipients join as ordinary learners (`USER`). An invitation can never grant ADMIN or SUPER_ADMIN; any role
  sent by a client is ignored.
- No tenant or organization is assigned. **Every list, count and action is platform-wide today. When real
  tenancy exists, each must be scoped to the active tenant before any tenant administrator gets access.**
- Accepting requires Google sign-in. Gmail, Google Workspace and other addresses registered as a Google Account
  all work; we never judge this from the email domain. Email-code / magic-link sign-in is not implemented.

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
     `{ newAccount: true, signupsPausedBypass: true }`. If the invitation is revoked or expires mid-sign-in,
     an account created only for it is removed again.
5. Accepting again with the same account is idempotent.

## Statuses and safeguards

- Invitation status: `pending`, `accepted`, `expired` (derived from `expiresAt`), `revoked`.
- Delivery status is separate: `SENT` (accepted by the mail server — not proof of inbox delivery), `FAILED`
  (invitation stays pending; fix email and Resend), `DEV_CAPTURED` (local only, nothing sent).
- Tokens: 32 random bytes, stored only as SHA-256, single use. **Resend** issues a new token and expiry, so the
  previous link stops working. **Revoke** stops the link; accepted invitations cannot be revoked.
- Expiry: `INVITATION_EXPIRY_DAYS` (1–30, default 7).
- Audit: `AdminAction` rows `invitation_create`, `invitation_resend`, `invitation_revoke` with
  `targetResource = invitation:<id>` and content-free metadata (no email, name or token).
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

## Remaining for real tenant membership

- A tenant/organization model with membership, and a real tenant-administrator role with its own authorization.
- Tenant-scoped invitation creation, listing, counts and acceptance (the invitation records which tenant it joins).
- Tenant-scoped Users and analytics, with cohort suppression applied per tenant.
- Optionally, non-Google sign-in (email code / magic link) for recipients without a Google Account.
