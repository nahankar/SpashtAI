# Admin analytics

Dashboard numbers come from first-party database records. Microsoft Clarity is a separate, consent-gated usability tool and is never a source for those numbers.

## Event contract

`FeatureUsage.duration` remains request latency in milliseconds for events written by API middleware. Active foreground time is `engagementMs`. A page exit counts time only while the tab is visible and the learner has used the pointer or keyboard within the last 60 seconds.

New events use `schemaVersion` 2 and may include `eventId`, `visitId`, `path`, and `outcome`. Repeating the same `eventId` does not create a second row. Admin and super-admin activity is acknowledged and not stored. Metadata is limited to short operational fields. Transcripts, answers, and feedback text are not stored in telemetry.

Active time and the newer milestone names begin at the deployment of this release. Older rows keep their original action names. The admin UI says “Not recorded yet” when a milestone has no sample, instead of presenting that absence as zero usage. Session counts, durations, interview runs, Prepare journeys, feedback, and Progress Pulse scores use the existing product tables for the selected date range.

## Metrics

Progress Pulse aggregates eligible score rows and excludes admin accounts. Age bands are calculated from date of birth at read time. Demographic slices with fewer than five learners hide their counts and scores.

Feature usage reports unique learners, first-time and returning learners, milestone reach, median and 75th-percentile active time, daily users, stickiness, and week-one return when the range is at least 14 days and the cohort has at least five learners. Replay, Elevate, Interviews, Prepare, and Feedback also include counts and durations from their own tables.

Language signals on Progress Pulse and on the Replay, Elevate, and Progress Pulse usage tabs are medians of stored speech and text analysis: pace, filler rate, hedging rate, sentence length, vocabulary diversity, Flesch readability, and topic coherence. They use the same learner cohort and date range. Phrases, entities, and transcripts are not included. Filters are city, state, gender, and age. A leftover pincode query is ignored.

## Microsoft Clarity

Set `VITE_CLARITY_PROJECT_ID` for a production build. Clarity loads only after a non-admin learner chooses Allow in the banner or in Settings. The choice is stored locally as `spashtai_analytics_consent`. Clarity receives the account id and a coarse feature tag. It does not receive name, email, transcript, answers, feedback text, or recordings. Input masking remains Clarity’s default.

The privacy policy default and the in-app fallback describe this split. A privacy policy already saved in the database is not overwritten; update it in Admin → Legal if that copy is older than this release.

## Backfill

Do not invent active time or new funnel steps for historical visits. Canonical product tables remain the historical source for sessions, scores, journeys, interviews, and feedback.

## AI Analytics Explorer

`/admin/analytics/explorer` turns an admin's natural-language question into a versioned, validated query plan. The model cannot generate SQL and receives no learner rows, names, emails, transcripts, answers, detected phrases, entities, or feedback text. The server executes only allowlisted demographic, feature-adoption, Progress Pulse, and language-signal operations.

“Used a feature” is based on retained canonical records, supplemented by meaningful `FeatureUsage` actions. Opening a dashboard, viewing results, or starting the feedback form does not count. Prisma and Cube use the same rules:

- Elevate: non-discarded communication sessions with module `elevate`, excluding Prepare practice and Interview runs
- Replay: communication replay sessions that are not Prepare recordings
- Interviews: interview runs whose session was not discarded
- Progress Pulse: eligible Pulse rows, including provenance-confirmed Replay rows. Telemetry counts only `tracked`
- Prepare: preparation journeys
- Feedback: submitted feedback records

Age is completed years from `AGE(CURRENT_TIMESTAMP, dateOfBirth)`, the same expression the other admin dashboards use. A range predicate applies the requested period to both canonical records and telemetry; “never” without a period means lifetime. A gender, age-band, or state breakdown returns up to 12 groups, and any group under five learners is hidden.

The model returns a plan and does not run it. The admin can correct filters, then run that plan. The run is what gets saved. Admin and super-admin accounts are always excluded from learner cohorts. Aggregate demographic results stay hidden below five learners. A language median or Progress Pulse average is also hidden when fewer than five learners actually contributed that score, including on a short identity list. The learner list itself is name, email, and join date. An explicit “who” query may return a paginated name/email list to an authenticated admin; that access is audited, and identities are fetched only after the plan has run. They are never sent to the AI model. A page past the end of the list keeps the real total.

Each admin keeps up to 15 unpinned recent plans. Pinning preserves a plan until it is deleted. Pinned cards rerun the saved plan without another model call and refresh only while the browser tab is visible. Those automatic refreshes do not write an audit row. Opening or manually refreshing a saved plan does. A stored plan that no longer matches the contract is skipped instead of failing the whole history list. Usage percentages are calculated in one SQL ratio so a small used subset of a large cohort stays a percentage.

### Cube Core proof-of-fit

Cube Core 1.8.5 was tested read-only against local PostgreSQL 16. The semantic model matched canonical SQL for: male learners over 40 with no feature usage, Elevate users who never used Replay, male-versus-female Elevate percentages, and filler-rate medians. Admin identity pagination and group-based member visibility also worked.

Cube is deployed with development mode and the SQL API disabled. Server-to-server JWT groups separate aggregate AI members from admin identity members. Every AI-visible demographic measure must implement the five-learner threshold; the Express gateway still owns identity authorization and auditing. The Cube model duplicates canonical feature definitions, so any Prisma change to those definitions must update and test the Cube model in the same release.

Timescale `pgai` is not used. It was archived and became unsupported in February 2026, and its vector/RAG workflow does not solve governed cohort analytics.

## UX Analytics and Microsoft Clarity

`/admin/ux-analytics` shows authenticated first-party page views, distinct learners, daily trends, top routes, and visible non-idle active time from `FeatureUsage`. Admin and super-admin traffic is excluded. Demographic filters use the same five-learner suppression threshold as the other analytics pages.

Microsoft Clarity is complementary UX diagnostics, not the source of these numbers. The web app loads Clarity only in production, after the learner grants analytics consent, when `VITE_CLARITY_PROJECT_ID` is present. It never loads on `/admin`. Microsoft does not support embedding the general Clarity dashboard in a custom iframe, so the admin page links to the Clarity project for recordings and heatmaps.

On EC2, set `VITE_CLARITY_PROJECT_ID` and optionally `VITE_CLARITY_DASHBOARD_URL` in `apps/server/.env`. `infra/ec2/deploy.sh` reads them and bakes them into the frontend build. Changing either value requires another web deployment.
