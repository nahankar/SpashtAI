# Workspace session review (Owner/Admin, read-only)

Active Owners and Admins of an organization workspace can review the Elevate, Replay and Interviews sessions that
learners created **in that organization**: recordings, transcripts, results, answers and technical feedback. Prepare is
not reviewable yet. Personal activity and other organizations are never visible. Review is read-only and audited.

## Permission model

Access is decided in three layers; each one alone refuses Personal, other organizations and non-managers.

1. **Workspace token and membership.** Every review request (and every playback range request) runs
   `withWorkspaceAccess`: the workspace token's membership must still exist, be `ACTIVE`, belong to the token's user and
   workspace, and the workspace must be `ACTIVE`. `requireWorkspaceManager` then requires an `ORGANIZATION` workspace
   and the `OWNER` or `ADMIN` role *now* (a role or state change applies to the next request; there is no cached grant).
   A platform `ADMIN`/`SUPER_ADMIN` role grants nothing here.
2. **Database reviewer reader** (`20261104120000_workspace_session_review`). `withSessionReview`
   (`apps/server/src/workspaces/sessionReview.ts`) writes the audit row, switches the transaction to `READ ONLY`, then
   sets `app.workspace_reader='reviewer'`. New SELECT-only policies `workspace_review_read` on `Session` and
   `ReplaySession` call `workspace_review_reads(workspaceId)`, which is true only when **all** hold, rechecked per row:
   - reader is `reviewer` **and** `transaction_read_only` is `on` (review visibility can never exist in a writable
     transaction, so no write path can ride on it);
   - the row's workspace is the verified `app.workspace_id`, and that workspace is an `ACTIVE` `ORGANIZATION`;
   - the actor (`app.workspace_actor_id`) is an `ACTIVE` `OWNER`/`ADMIN` member of it.

   The `Session` policy additionally requires `workspaceKind='ORGANIZATION'`, `discardedAt IS NULL`, purpose
   `COMMUNICATION`/`INTERVIEW` and no `PreparationPractice` link; the `ReplaySession` policy requires purpose
   `COMMUNICATION` and no `PreparationRecording` link (`workspace_review_excludes_prepare`, SECURITY DEFINER, so Prepare
   rows themselves stay invisible). Child tables (transcripts, turns, segments, recordings, metrics, interview runs,
   attempts, chunks, answers, assessments, Replay results and uploads) keep their existing parent-boundary policies,
   which admit reads of a visible parent for every reader except `manager`. All of them have forced RLS (checked by
   `assertWorkspaceDatabaseSafety`). The aggregate `manager` reader is unchanged and still sees no child content.
   `DataScope.reader` cannot be `reviewer`, so product routes and jobs never enter review mode.
3. **Explicit presenters.** The server selects and returns allowlisted fields only; stored JSON is never spread.

Not returned: recording/upload file paths, egress ids, provider ids, storage keys, model names, token counts, insight
provider/error fields, delivery evidence, Replay `modelUsed`/tokens, interview `goodAnswerPoints`, `exampleAnswer`,
`expectedDepth`, `followUpGuidance`, `followUpQuestion`, evaluator config and validation notes, BankFollowUpJob
payloads, and staff-only feedback notes (not part of review at all). Technical feedback follows the learner's own rule:
shown only after the practice ended, never for an answer with an incomplete transcript.

## API (`/api/workspaces/current/review/...`, workspace token as `Authorization: Bearer`)

| Route | Purpose |
| --- | --- |
| `GET sessions?learner=<memberId>&product=elevate\|replay\|interviews&status=in_progress\|completed\|failed&from=YYYY-MM-DD&to=YYYY-MM-DD&after=<cursor>` | 50 per page, newest first; dates are days in the workspace time zone |
| `GET sessions/:product/:id` | Read-only detail (Elevate/Interviews: transcript, metrics, skill scores, coaching, recordings; Interviews: questions, captured and saved answers, technical feedback; Replay: transcript, scores, feedback, recordings) |
| `POST sessions/:product/:id/recordings/:recordingId/ticket` | Audited, 1-hour playback ticket bound to the reviewer's membership and exactly this recording |
| `GET sessions/:product/:id/recordings/:recordingId/stream` | Byte ranges (200/206/416, `HEAD`), `Cache-Control: private, no-store`, `nosniff`; authorised by the workspace token header **or** `?review_media=<ticket>` |

Playback opens a file only beneath `<root>/workspaces/<workspace>/sessions|replay/<activity>/` (realpath with no
symlink below the root, `O_NOFOLLOW`), serves only audio/video MIME types, and rechecks the reviewer on every range
request, so a demoted or suspended reviewer's ticket stops working immediately. Replay video needs the workspace
`ultra` plan, audio `pro` or `ultra` (the organization plan, as for learners). The ticket parameter is redacted from
request logs like `workspace_media`. Known ids from another organization, Personal, a discarded or Prepare session, or
a recording of another session return 404.

There are no delete, edit, export, download, reprocess or impersonation routes in review, and the database refuses
writes in the review transaction.

## Audit

`WorkspaceAudit` rows (`actorUserId`, `workspaceId`, `createdAt`): `session_review_list` (filters: learner member id,
product, status, dates), `session_review_detail` (subject = session id, product), `session_review_media_ticket`
(subject = session id, product, recording id) and `session_review_recording` (header-authenticated streams, per
request, with whether a Range was sent). Ticket streams are audited at issue time. Rows never hold transcript, answer,
feedback or file content. The audit row is written in the same transaction as the read, so a refused or not-found
request leaves no record and a recorded access always succeeded. (The dev server's React StrictMode loads pages twice,
so local walkthroughs show duplicate list/detail rows; production builds do not.)

## Learner notice

`WORKSPACE_PRIVACY_NOTICE` now reads: "Organization activity stays in this workspace, and its Owners and Admins can
review your sessions here. Your Personal history remains separate and private." It is returned on workspace entry
(invitation acceptance card) and in the workspace snapshot (learner home), where the web shell already shows it.

## Decisions

- **Learner flags.** `hideTranscriptText`, `hideAudioDownload` and the other `User` export flags are the learner's own
  (Personal-plane) view controls; inside organizations they already do not apply to product pages
  (`organizationExportFlags`). Review ignores them; the learner-own archive keeps applying them to the learner. A
  learner's per-member product restriction (`WorkspaceMemberFeature`) does not hide sessions created earlier, and the
  reviewer's own product access does not gate review. Visibility is decided only by the database scoping above.
- Sessions of suspended or departed learners remain reviewable (they belong to the organization); departed learners
  show as "Former member".
- Elevate/Interviews recordings are served per segment (no server-side merge, which would write files during review).
- In-progress sessions are listed and viewable (status `in_progress`), without technical feedback until they end.

## Verification (4 November 2026, branch `feature/workspace-session-review`)

- `test/workspace-session-review-database.test.ts` (13 tests, isolated DB): two organizations plus Personal, filters
  and paging, Elevate/Interviews/Replay detail without internal fields, header and ticket playback with 200/206/416/HEAD,
  ticket bound to one recording, cross-session/symlink/other-org/Personal/discarded/Prepare probes (404), database
  read-only enforcement (UPDATE/DELETE fail in review; a writable transaction with the reviewer reader sees and changes
  nothing; learners and the manager reader see no other learner's content), content-free audit, learner flags and the
  learner archive, Admin demoted to Learner (API, ticket and direct database all refused), suspended Admin, suspended
  workspace, learner notice. A mutation run without the `transaction_read_only` check fails the database test.
- Regression on the same isolated database: Session archive, analytics, product plane, isolation stress, Elevate,
  Replay, Interviews and workspace database suites. DB suites accept any database in the 55443 container through
  `test/workspace-test-db.ts`.
- Real browser (Playwright Chromium, headless) against a local API/web on 4150/5313: Users → learner → Sessions →
  Review; Load recording; play, seek to 21 s and continue; responses 206 with `Content-Range`, ticket in URL, no
  identity token in URL, no write buttons.

## Remaining

- Prepare review (journey sessions and recordings) is out of scope and excluded by policy.
- Real-browser playback was verified headless with a WAV fixture in Chromium only; Safari/Firefox and large WebM/Opus
  recordings from production capture are not yet exercised.
- Legacy egress recordings stored outside the workspace session prefix are reported as unavailable rather than served.
- No retention/export for review audit rows yet beyond `WorkspaceAudit` itself.
