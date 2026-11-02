# Workspace signup fields and invitations

Platform administrators: open **Admin → Workspaces**, select an organization, then use **Workspace signup and invitation message**.
Workspace Owners and Admins: open `/w/<slug>` and use the same editor.

## Additional details at invitation acceptance

Add up to 20 fields, in display order. Supported types are text, dropdown, radio buttons, multiple checkboxes, and a plain text message. Fields can be required or optional; messages do not collect an answer. Choice fields support 1–30 unique options. Labels/messages support 200 characters, choice labels 120, and text responses 1,000.

The invited person completes this form before Google sign-in. The normal phone, date of birth, gender and postal-code profile flow remains unchanged and is requested separately if needed. Existing accounts keep their profile and Personal history. Additional responses belong to the workspace membership, never to the global profile. Workspace managers can expand **Workspace details** under a member to review them. Learners cannot list other members' responses.

Each new email invitation stores its own form and email snapshot. Changing settings affects future invitations only. Resend preserves the original form and message; revoke an old invitation and create a new one to use revised settings. Already accepted links do not overwrite responses. These changes do not force existing members to fill a new form on every sign-in, and the bootstrap Owner's direct membership acceptance remains unchanged.

Required fields and choice values are validated on the server under the invitation/workspace locks, before an account is created. Invalid input leaves the invitation pending and creates no identity or membership. Responses, membership acceptance and audit commit together. Custom responses and email bodies are not copied to audit metadata. Membership/account deletion removes the responses through existing cascade rules. No organization product access is enabled by these changes.

## Email content

A workspace administrator can save a default subject (150 characters) and message (5,000 characters). Platform invitations and bulk invitations also allow a message for that send. Empty values use the existing default. Content is plain text, escaped in the HTML email. Mandatory workspace context, genuine acceptance URL, expiration, Google sign-in instructions and mailbox footer remain present. Subject line breaks are rejected.

## Multiple invitations

Use **Invite multiple users** in Admin → Invitations or in a workspace. Paste up to 20 addresses, one per line or separated by commas/semicolons. The UI normalizes case and removes duplicates. Review recipients and message, then confirm. Bulk sends use the Learner role with default feature permissions; use the single-invitation form for other roles or overrides.

Each recipient receives an independent private email and token. There is no shared recipient list. Creation, capacity checks and audit are per recipient, with no more than three concurrent deliveries. One failed recipient does not roll back successful invitations. Results distinguish email-server acceptance, failed email, development capture and invitation conflicts. SMTP acceptance does not prove inbox arrival. Retry only failed recipients; for saved invitations use Resend.

Platform batches can optionally include existing accounts with an explicit checkbox; doing so never changes their role or data. Pending invitations are not sent again automatically. Workspace seat reservations, current inviter permissions and signup-pause policy remain enforced. A shared in-process 60-recipient-attempt hourly budget covers single, bulk and resend actions by the same actor across platform/workspace paths, in addition to existing request rate limits. Like the existing limiter, this budget resets on process restart and is not a billing ledger.

## Release validation

- Full server suite with isolated tenancy database: 685 passed, 124 optional skipped.
- Web suite: 335 passed.
- Web typecheck, server build, changed UI lint, migration upgrade/backfill verification passed.
- Local browser: saved required Department dropdown and custom email; two-recipient batch displayed two development-capture results and updated the invitation list. No real emails sent by the checks.
- Real Google authentication remains a human test; the database tests use verified synthetic identity fixtures.
