# Tenant custom filters and Excel export handoff

Status: reviewed, locally validated, awaiting merge/release approval. No merge,
deployment, production feature enablement or real invitation send was performed.

## Inventory

Branch: `feature/admin-field-filters-export`.
Base/current remote main inspected: `810a65b0e76644d0722846e0ec3020823df96f9c`.

| Commit | Purpose |
| --- | --- |
| `43dfafe3a4690242a57aead4c2d1aa9296452125` | Existing isolated Supertest IPv6-loopback harness correction |
| `64e37de958225d917b653ab764bc25d18dbc9201` | Custom choice-field filters, authenticated Excel reports, tenant tab titles and documentation |
| `87abfae5b6406436ecae00fdcc2219a60b27fc49` | Move the shared filter hook out of a component module to satisfy Fast Refresh lint |
| `240500026081961270c97c11d53867608493b25a` | Batch analytics identity reads; verify complete 10,000-row reports and permit the membership suite on the dedicated test database |

Final tested application revision: `240500026081961270c97c11d53867608493b25a`
for web and API. The subsequent evidence-only commit does not change application code.

## What changed

- Workspace settings offers **Add filter** for custom dropdown/radio/checkbox
  fields only. Mobile number, DOB, gender, pincode, text fields and messages are
  not report filters.
- Current definitions select tenant-membership answers, using OR within a field,
  AND across fields and explicit No answer handling. Dashboard, Users, Feature
  usage and Pulse share this tenant-bound cohort. Existing filters still combine.
  Custom choices survive browser reload through URL parameters.
- Existing invitation snapshots/answers and Personal profiles/history are not
  rewritten. Recipient forms omit the reporting flag. Older settings default to
  nonfilterable. Invalid, removed or disabled field filters fail explicitly.
- Users, Feature usage and Pulse have visible **Export to Excel** controls.
  Exports contain complete matching reports, not the UI's 50-member, 200-action or
  500-learner page limits. Each sheet supports up to 10,000 rows; larger results
  fail instead of silently truncating. Relation reads are bounded in batches.
- Excel cells are text/numbers/dates, never formulas. Workspace headers carry
  authentication; no tokens go into download URLs. Attachments are private/no-store.
  Audits contain report/row counts and field identifiers/choice counts, not PII.
- Tenant tabs show `SpashtAI beta - <workspace name>` and restore the prior title
  outside the workspace.

See [admin report semantics](./ADMIN-ANALYTICS.md#tenant-administration-custom-fields-and-excel)
and [filter configuration](./WORKSPACE-SIGNUP-AND-INVITATIONS.md#custom-field-report-filters).
Capacity/budget cards remain organization-wide. No new demographic suppression
policy is introduced. Admin report export does not add session-review exports,
recording access, deletion or reprocessing, or change learner download settings.

## Validation actually run

All final checks below used the tested application revision above.

| Check | Result | Local evidence basename |
| --- | --- | --- |
| Full server: `vitest run --maxWorkers=1`, database fixture variables unset | 627 passed; 296 optional/database tests skipped | `admin-filters-server-2405000.log` |
| Restricted-role analytics, membership isolation, invitations and enrollment suites, sequential runner | 55 passed, 4 files | `admin-filters-db-2405000.log` |
| Full web: `vitest run --maxWorkers=1` | 384 passed, 64 files | `admin-filters-web-2405000.log` |
| `npm run build`; web `tsc -b` | Server/web builds and typechecks passed | `admin-filters-build-2405000.log` |
| ESLint on all ten changed UI/helper files | Passed | Earlier successful equivalent output: `admin-filters-ui-lint-final.log`; final repeat passed |
| Real native Playwright Chromium 156.0.8078.4 | 7 checks passed, no page errors, clean checkout | `admin-filters-browser-report.json` |

Database: dedicated `spasht_filters_test` on the isolated tenancy container at
127.0.0.1:55443, using `tenancy_test_app` (non-owner/NOBYPASSRLS) for API reads.
Guards allow only exact approved container/database URLs; runtime URLs use the
same database. Walkthrough, voice and other active databases were not used.

Database coverage includes tenant-specific answers for a shared learner, another
organization and Personal; absent/null/blank/empty-array answers; choice
validation; role/search/learner composition; suspended memberships and demotion;
auth failures; text-only `=`, `+`, `-`, `@`, tab and carriage-return canaries; audits
without answer values; all three **10,000-row** workbook boundaries; Users
**10,001-row** rejection; and 201 feature-action groups beyond the UI's 200 cap.
Full-suite and focused counts overlap and must not be added as distinct coverage.

Browser target: localhost:5333 web / localhost:4170 API, synthetic organization
`filters-browser-fa47ca84` ("KLS VDIT Test"), seeded accounts and real API routes.
The harness omitted global application workers and unrelated public endpoints;
it did not mock application API responses or use Google authentication.
Visible filter interactions/reload, all three downloaded/parsed workbooks,
Dashboard counts, settings controls and tab-title restoration passed. Screenshots
and workbooks are retained privately. Owned processes and fixtures were cleaned
up; no shared service was stopped.

Evidence directory:
`/Users/neelesh.ahankari/.copilot/session-state/3c04dd41-91ed-48f7-8dca-e70755704c05/files/`.
The adjacent [redacted evidence index](./TENANT-ADMIN-FILTERS-EXPORT.evidence.json)
contains final result counts and SHA-256 digests. Raw logs, browser artifacts,
authentication and prior failed/inconclusive evidence are not committed.

## Historical failures and limits

- Initial agent progress had stopped; implementation was completed directly.
- Earlier workbook tests needed a binary response parser and XML carriage-return
  normalization; additional fixtures needed required acceptance/Personal-stage
  values. Those failing logs remain intact.
- A real 10,001-member regression exposed Prisma's oversized relation predicates
  exceeding PostgreSQL stack depth. Counting first and batching relation/identity
  reads fixed this; the full 10,000-row exports subsequently passed.
- Mixed component/hook exports failed targeted lint; the hook was moved and lint,
  typechecks, builds and native browser validation rerun.
- Early browser attempts had stale-result/default-seat fixture expectations.
  Integrated browser download observation timed out; native Chromium downloaded
  and parsed actual files successfully. The historical failures are not relabeled
  as passes.
- Build chunk-size and stale Browserslist/baseline-data warnings remain; no final
  failing test or lint check remains. Other optional database suites were not run.
- This admin-only change alters no voice turn-taking, audio, dispatch, recording
  or voice controls. No voice-provider scenarios were run for it.
- Actual Google invitation acceptance, actual Safari playback, cached voice-client
  rollout compatibility and the separate missing-duration follow-up remain outside
  this delivery. Playwright Chromium is not Safari. Northwind's missing third
  reply remains unresolved; this work establishes no provider root cause.

## Merge dependencies and proposed release order

1. Review this branch and its evidence independently of the signup/location,
   voice/lifecycle, recognizer and session-review follow-ups. No merges between
   those release branches were performed.
2. On approval, integrate against the then-current main and rerun these gates.
   No migration is needed for the additive JSON metadata.
3. Release API before the matching web bundle: the web needs the new filters/export
   routes. Existing web clients can continue normal unfiltered reports.
4. Validate an authorized non-production tenant before considering production.
   No release step has been executed here.

A rollback to an older strict-schema API requires a separately reviewed/tested
removal of only `filterable` metadata from workspace settings and invitation/member
form snapshots, without changing responses or profiles. That older-API rollback
has not been validated and must not be assumed safe merely because no migration
was added. Releasing API/web together and retaining this API during a web rollback
is the safer proposed order.
