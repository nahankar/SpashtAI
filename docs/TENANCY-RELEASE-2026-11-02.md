# Workspace control-plane release — November 2, 2026

The user authorized review, fixes, GitHub main integration and EC2 deployment. Reviewed application commit:
`cd2acd5`. This report records the completed deployment; it does not enable tenant learning products.

## Review and validation

Release review fixed environment initialization before JWT/database imports, cross-user conversation writes
and state updates, unscoped conversation search and visibility restrictions, transactional user-deletion
audit, SMTP TLS/timeouts, secret-link logging and the sender/reply notice.

679 server tests passed (124 optional skipped), 332 web tests passed. Build/type checks and deployment shell
syntax passed. Restricted runtime provisioning/repeat execution was verified against the isolated database.
Earlier upgrade checks preserved existing Personal records and platform invitations across all migrations.

## Production evidence

- EC2 `/opt/spashtai` deployed reviewed code from GitHub main; API and agent are online.
- Verified PostgreSQL archive: `/opt/spashtai/backups/pre-tenancy-2026-11-02T16-45-09-989Z.dump` (4,046,374 bytes).
- All five release migrations applied. API/agent were stopped for migration maintenance; no active voice
  segments were found. The first invocation used the previously installed deploy script, followed by the
  guarded restricted-role transition once the new release was installed.
- API uses `spashtai_runtime`, without superuser or RLS bypass privileges. Twelve tables enforce forced RLS.
  Migration credentials live separately in `.deploy-migration.env`; both credential files have mode 600.
- Workspace administration enabled. Organization practice readiness remains false; archive rollout off.
- Temporary fictional production accounts verified organization creation/acceptance, scoped invitation lists,
  foreign-entry denial, tenant-token rejection at platform Admin endpoints and disabled archive/product gates.
  No Google verification or email was simulated as live success. Fixtures were removed afterward.
- Original totals unchanged: 106 users, 94 sessions, 82 transcripts, 68 recordings.
- Public HTTPS `/ready` returns ready; `/api/workspaces/config` enabled; web root HTTP 200 serves
  `assets/index-X8tZfT62.js`. The production LiveKit overlay files remain preserved.

## Pending email and human acceptance

`SMTP_PORT=465`, `SMTP_USER=info@spasht.ai` and sender `SpashtAI <info@spasht.ai>` are configured.
The no-mail production check reports only `SMTP_HOST` and `SMTP_PASS` missing. No emails were sent.
Get the exact Zoho server from account-specific settings, and enter the app password directly in
`/opt/spashtai/apps/server/.env`; never put it in chat, Git or command arguments. Then verify connection/login,
reload the API environment, and test delivery only to an explicitly approved recipient.

Google acceptance remains an end-user check with an invited Google-enabled address. The SMTP sender mailbox
does not need a Google Account. A Gmail, Google Workspace or other Google-registered address can be invited.
Invitations grant only organization membership; Personal records and platform roles remain separate.

Remaining tenant product isolation, voice/jobs, analytics, initial-Owner email provisioning and full browser/
microphone pilot are tracked in `TENANCY-STATUS.md`. KLSVDIT has not been provisioned in production.
