# Workspace signup fields and invitations

Platform administrators: open **Admin → Workspaces**, select an organization, then use **Workspace signup and invitation message**.
Workspace Owners and Admins: open `/w/<slug>` and use the same editor.

## Additional details at invitation acceptance

Add up to 20 fields, in display order. Supported types are text, dropdown, radio buttons, multiple checkboxes, and a plain text message. Fields can be required or optional; messages do not collect an answer. Choice fields support 1–30 unique options. Labels/messages support 200 characters, choice labels 120, and text responses 1,000.

The invited person completes this form before Google sign-in. The normal phone, date of birth, gender and postal-code profile flow remains unchanged and is requested separately if needed. Existing accounts keep their profile and Personal history. Additional responses belong to the workspace membership, never to the global profile. Workspace managers can expand **Workspace details** under a member to review them. Learners cannot list other members' responses.

Each new email invitation stores its own form and email snapshot. Changing settings affects future invitations only. Resend preserves the original form and message; revoke an old invitation and create a new one to use revised settings. Already accepted links do not overwrite responses. These changes do not force existing members to fill a new form on every sign-in, and the bootstrap Owner's direct membership acceptance remains unchanged.

### Custom-field report filters

Owners/Admins can check **Add filter** on a custom dropdown, radio or checkbox field in Workspace settings. Text fields and messages are not filters. Default profile fields (mobile number, date of birth, gender and pincode) are excluded.

The workspace's **current** filter configuration drives Dashboard, Users, Feature usage and Progress Pulse. This is independent of invitation form snapshots: enabling a filter can use already-collected membership answers, but never recollects or overwrites them. Disabled/deleted fields are no longer accepted as filters. Changed options do not rewrite old answers; only current options can be selected. `__none__` is reserved and cannot be a filterable option.

Choose multiple options for an OR within a field; selections across fields use AND. **No answer** includes absent/null/blank answers and empty checkbox lists. There are at most ten selected choices. Custom selections are stored in the page URL and survive reload; **Clear custom filters** removes them, including stale selections after a settings change.

The invited recipient sees the questions, not the report-filter flag. This does not change signup validation, account profiles, membership permissions or Personal history.

Required fields and choice values are validated on the server under the invitation/workspace locks, before an account is created. Invalid input leaves the invitation pending and creates no identity or membership. Responses, membership acceptance and audit commit together. Custom responses and email bodies are not copied to audit metadata. Membership/account deletion removes the responses through existing cascade rules. No organization product access is enabled by these changes.

## Email content

A workspace administrator can save a default subject (150 characters) and message (5,000 characters). Platform invitations and bulk invitations also allow a message for that send. Empty values use the existing default. Content is plain text, escaped in the HTML email. Mandatory workspace context, genuine acceptance URL, expiration, Google sign-in instructions and mailbox footer remain present. Subject line breaks are rejected.

## Multiple invitations

Use **Invite multiple users** in Admin → Invitations or in a workspace. Paste up to 20 addresses, one per line or separated by commas/semicolons. The UI normalizes case and removes duplicates. Review recipients and message, then confirm. Bulk sends use the Learner role with default feature permissions; use the single-invitation form for other roles or overrides.

Each recipient receives an independent private email and token. There is no shared recipient list. Creation, capacity checks and audit are per recipient, with no more than three concurrent deliveries. One failed recipient does not roll back successful invitations. Results distinguish email-server acceptance, failed email, development capture and invitation conflicts. SMTP acceptance does not prove inbox arrival. Retry only failed recipients; for saved invitations use Resend.

Platform batches can optionally include existing accounts with an explicit checkbox; doing so never changes their role or data. Pending invitations are not sent again automatically. Workspace seat reservations, current inviter permissions and signup-pause policy remain enforced. A shared in-process 60-recipient-attempt hourly budget covers single, bulk and resend actions by the same actor across platform/workspace paths, in addition to existing request rate limits. Like the existing limiter, this budget resets on process restart and is not a billing ledger.

## Release validation

- Full server suite with isolated tenancy database: 687 passed, 124 optional skipped.
- Web suite: 338 passed.
- Web typecheck, server build, changed UI lint, migration upgrade/backfill verification passed.
- Local browser: saved required Department dropdown and custom email; two-recipient batch displayed two development-capture results and updated the invitation list. No real emails sent by the checks.
- Real Google authentication remains a human test; the database tests use verified synthetic identity fixtures.

## Recipient previews and first Owner handoff

Open **Preview recipient experience** in the workspace settings editor, a single invitation, or a bulk invitation. **Invitation email → Generate email preview** renders the server's actual email template, including the edited subject/message, Google sign-in instructions and footer. The recipient and expiry are samples; the acceptance link is an inactive fragment. No token, invitation or email is created. The HTML is displayed in an iframe sandbox without scripts, forms, same-origin access or top-level navigation. The plain-text MIME version is also available.

**Signup fields** shows the same custom field renderer as invitation acceptance, followed by the normal phone/date-of-birth/gender/pincode controls. All preview controls are disabled. It explicitly shows that custom details precede Google acceptance and that already-complete regular profiles skip step 2. Unsaved form/email edits can be previewed; preview does not save them.

Creating a workspace assigns an **INVITED Owner** membership to an existing verified account, but sends no email automatically. In **Admin → Workspaces → select organization → Workspace Owner access**, the platform Admin now sees each assigned Owner's email and state, the full workspace login URL, and copyable access instructions. **Send access email** requires an explicit recipient confirmation. It sends only to an already-assigned, verified, active/pending Owner of that workspace. It cannot assign a role, change permissions, or enroll a different person. Development mode sends nothing. Request and outcome are audited without copying the email address or message into metadata; a post-send audit failure cannot turn an SMTP success into a reported send failure.

For the existing KLSVDIT organization, share `https://spasht.ai/w/klsvdit` with the assigned Owner shown in this panel. The Owner signs in using the Google Account for the assigned email and selects **Accept invitation** if their membership is pending. There is no tenant password. They can then invite other people, choosing **Admin** for another workspace administrator or **Learner** for users. Workspace administrators work at `/w/klsvdit`; `/admin` remains the platform Admin panel. Someone who is not assigned membership cannot gain access just by knowing the URL. No real Owner email is sent during release verification.

This remains workspace administration only: organization practices and analytics are not enabled. The initial Owner must already have a verified SpashtAI account; for a new person, send a platform invitation first and create the workspace after they have completed it.

Preview/Owner handoff verification on 3 November 2026: the local browser rendered the real invitation template and disabled signup controls, and displayed the pending Owner identity/link with an explicit send confirmation. The development send path truthfully reported no email sent. The invitation database suite passed an additional injected post-send audit failure while preserving the SMTP-success result.
