# Learner invitations

Platform Admins (ADMIN / SUPER_ADMIN, rechecked in the database on every request) can invite a person to
SpashtAI by email. Invitations are available from **Admin → Users** (Invite user), **Admin → Invitations**,
and the Tenant Admin demo Dashboard. All three use the same server service (`apps/server/src/lib/invitations.ts`).

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
   page says **Switch Google account** and nothing changes.
4. Account handling reuses normal Google sign-in (`lib/googleSignIn.ts`):
   - Existing account: signed in; role, permissions, flags and history are unchanged; no duplicate is created.
   - New account: created as `USER` only if signups are open (the signups-paused control still applies and the
     invitation stays pending), then the normal profile/terms onboarding runs.
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
  Acceptance is recorded as `UserActivity` `invitation_accepted`.
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
"Captured invitation emails (development only)" and at `GET /api/admin/invitations/dev-mailbox`, which returns
404 when capture is off. `INVITATION_EMAIL_DELIVERY=capture` forces capture in any environment.

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
