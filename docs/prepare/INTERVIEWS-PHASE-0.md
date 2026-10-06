# Interviews Phase 0: activity policies and pilot foundation

Implemented on `codex/interviews-foundation`. This phase creates the policy boundary before introducing interview screens or extracting the shared live engine.

## Behavior

| Activity | Purpose | Context |
| --- | --- | --- |
| Ordinary Elevate | COMMUNICATION | COMMUNICATION_PROFILE: existing personalization retained |
| Ordinary Replay | COMMUNICATION | SESSION_ONLY |
| Existing Prepare live or recorded practice | INTERVIEW | JOURNEY |
| Future quick interview practice | INTERVIEW | SESSION_ONLY; launch endpoint still to be implemented |

`Session.module` continues to describe the underlying engine. `purpose` describes the activity. Creation sets policies on the server. Existing ownership links remain the source of truth for journey association and deletion.

Database constraint triggers require linked live/recorded practices to have INTERVIEW purpose, JOURNEY context and the journey owner's user ID at transaction commit. Engine creation and linking already occur in one transaction. Non-interview Prepare journeys need an extension to this rule in the later Prepare phase.

SESSION_ONLY and EXPLICIT_SOURCE currently load no cross-session history. EXPLICIT_SOURCE retrieval is reserved for a later phase. JOURNEY loads the linked journey context and fails if that context cannot be resolved. Ordinary Elevate preserves its communication profile. Configuration snapshot fields are available; versioned interview snapshots will be populated when question versions and launch configuration exist.

## Policy audit

Purpose filtering now covers standalone Elevate/Replay histories, Coach context and recent activity, admin counts and history, and communication-profile queries. Final Pulse and points writers also verify purpose and ownership; a caller omitting purpose cannot establish eligibility. The inactivity worker may still produce communication analysis for an interview activity but cannot award points or write that result to Pulse. Interview answer evaluation and the Interviews Retain bucket belong to the quick-practice phase.

Ownership checks used for authorized access, journey association, exports and deletion were retained. They should not be mechanically replaced with purpose checks.

LiveKit token and manual dispatch routes require authentication and verify the saved session, active segment and room. Identity and coaching metadata come from the authenticated user and saved session. Existing room ownership is verified before metadata updates; Hush remains fixed for an active room. A partial database index prevents two open segments claiming the same room.

Interviews Admin settings support Everyone or Selected users and granting/revoking individual access. Other modules do not expose pilot audiences; server validation rejects selected-user audiences and grants for them. The new `interviews` flag starts hidden, disabled and restricted to selected users. A grant does not override hidden/disabled switches. Audience resolution is per user, outside the shared feature cache. Future interview endpoints must use `requireFeature('interviews')` after authentication.

## Database deployment

No application or production database was migrated during development.

### Existing installation

1. Back up and verify the target and its migration history. Confirm the existing schema includes current Prepare ownership and SessionSegment tables. The upgrade was tested against the canonical pre-phase-0 schema; production drift needs checking separately.
2. Check for duplicate open `SessionSegment.roomName` values and journey/user ownership mismatches. Resolve these before applying the migration; do not silently relabel invalid data.
3. Let active voice sessions finish before deployment. Generate Prisma and build/validate the release before entering maintenance. The deployment script then stops the API (including its background workers) and voice agent; requests are unavailable during migration. Old server processes cannot create journey-linked sessions correctly once the new constraint is installed.
4. Run `npm --workspace apps/server exec prisma migrate deploy` against the intended database while writers are stopped. The deployment script keeps processes stopped on migration failure; resolve the failed migration before restarting compatible code.
5. Start the updated server and workers, then check ordinary Elevate, Replay, existing Prepare launches, inactivity completion and Admin grants. Leave Interviews hidden until its routes and UI are implemented.

The additive migration backfills ordinary live sessions with COMMUNICATION_PROFILE and existing journey activities with INTERVIEW/JOURNEY. It does not delete data or edit previously applied migrations. Preserve these classification columns if rolling back application code; restoring older writers requires a coordinated rollback of the new constraint or a compatible code version.

### Empty installation

The historical migration chain does not build a clean database: an early VoiceConfig alteration precedes its table and other historical schema changes are absent. A frozen full-schema baseline fixes empty installs without changing historical migrations.

Set `DATABASE_URL` explicitly, then run from the repository root:

```sh
node apps/server/prisma/scripts/initialize-empty-database.mjs
npm --workspace apps/server exec prisma migrate deploy
```

The initializer refuses databases containing tables. It applies `phase0-baseline.sql` and marks only the frozen list in `phase0-baseline-migrations.json` as applied. Later migrations execute normally. If initialization fails halfway, inspect the disposable/new target before retrying; do not use this script to repair an existing installation.

## Verification

All 398 tests in 49 server test files and 127 tests in 17 web test files pass. Regression coverage includes purpose filtering, isolated versus profile/journey context, selected-user access and revocation, abandoned interview rewards, authenticated LiveKit ownership, persisted room metadata and Hush preservation. Web type checking and web/server production builds pass. Lint has no errors and two existing hook warnings in Elevate and Replay.

Disposable PostgreSQL 16 databases validate the complete fresh baseline, the upgrade/backfill from the canonical previous schema, deferred journey checks, defaults, grant cascades and active-room uniqueness. The empty initializer was exercised end to end; migration deployment then reported no pending migrations, and rerunning the initializer refused the populated database.

Live voice and browser workflows still need a smoke test against a migrated application environment. No production rollout is implied by these automated checks.

## Next phases

1. Extract the shared live-session hook/controller in a separate behavior-preserving change. Cover start, pause/resume, reconnect, recording, discard, completion and existing Prepare launches. Preserve current Elevate personalization and Hush behavior.
2. Add question/version import and private evaluator material, rubric evidence and input-hash result reuse. Establish answer snapshot source/revision and prompt-injection handling.
3. Replace the live token/dispatch Elevate-only feature gate with a server-resolved activity-purpose gate before exposing Interviews. Interviews must continue working when Elevate is disabled. Add quick interview practice, thinking-pause handling, multi-turn answer assembly, hints/example disclosure labels, feedback timeout behavior and an Interviews Retain bucket before exposing pilot access.
4. Add interview journeys and mocks, navigation and old-route redirects, then recorded interview practice and recording consent.
5. Expand Prepare to pitch/presentation and other goal journeys, extending the purpose invariant by journey type.

Use “Quick Practice” for interview UI; existing `quick_try` remains the Communication Snapshot feature, not an interview route.

## Review corrections

Replay IDs presented to the internal agent context endpoint return empty context rather than entering the live-session loader. Broken journey context remains an error. Message logging requires a previously created session and cannot lazily create one. The user-metrics route checks owner/admin access and applies the same standalone communication filter to records, counts and averages. Session/Replay constraint triggers run only for inserts and policy/owner updates. Pilot invitations show email independently of search, and user search is debounced.

Before merge, smoke-test ordinary Elevate personalization, booth/snapshot, pause/resume/reconnect, existing Prepare live and recorded launches, journey-only context, recording completion and inactivity handling against a migrated test environment. Production schema/precondition checks and actual live voice testing remain outstanding.
