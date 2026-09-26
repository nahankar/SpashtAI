# Replay learner-specific delivery evidence — implementation handoff

## Baseline and scope

- Baseline: `04aa9f253510b26e9b7e63a8276275fd2f6f168b`.
- Branch: `feature/replay-delivery-evidence`.
- Worktree: `/Users/neelesh.ahankari/Applications/SpashtAI-replay-evidence`.
- Main checkout is unchanged and clean at the same baseline.
- This is an uncommitted implementation for coordinator review, not a production release.
- No commits, pushes, merges, deployment, EC2 access, production database access, real-user audio uploads, paid transcription or LLM calls were made. External processing is mocked in tests.
- Dependencies and Prisma client were installed/generated only in this worktree. No manifests, lockfiles, environment files, infrastructure, agent/Elevate files, global routes, global flags, or shared scoring/coaching/PDF/Pulse engines changed.

## Completion by work package

| Package | Replay-owned implementation | Limits before rollout |
| --- | --- | --- |
| R1: honest results | Done: unavailable pace/identity; no 150-WPM fallback or silent cap; word share label; unknown interruptions; safe legacy read adapter; report and progress input safeguards | Global historical Coach/Pulse readers need coordinator integration below |
| R2: source evidence | Done: normalized batch/streaming words, punctuation, nullable recognition confidence, validated label joins, recording identity/duration, versioned cache | No human timing-accuracy certification; batch/streaming service calls tested with mocks |
| R3: learner identity | Done: explicit single-label confirmation, excerpts/authorized previews, optimistic revisions and locked invalidation; audio/uploaded-text separation | Multiple labels cannot be combined as one learner; text-only personal feedback requires confirmation then explicit re-analysis |
| R4: moments/playback | Done: model-timed learner word gaps, weighted eligible pace, exact bounded media playback, accessible controls, partial/unavailable/empty states | No acoustic silence, interruption attribution, emotion/personality, Praat/Gentle, or calibrated voice claims |

The overall asynchronous Replay workflow retains `pending`, `transcribing`, `analyzing`, `completed`, `failed`. Evidence within a completed analysis independently reports `available`, `partial`, `empty`, or `unavailable`; no unsupported claim is promoted by a workflow completion flag. Existing process/status UI handles pending/failed analysis. No new polling worker or global queue was added.

## Changed files

Existing files:

- `apps/server/prisma/schema.prisma`: two nullable Replay JSON fields only.
- `apps/server/src/lib/aws-transcribe.ts`: retain normalized batch words.
- `apps/server/src/lib/aws-transcribe-streaming.ts`: preserve final word items/confidence, deduplicate result IDs, mark interrupted streams, safe ffmpeg argument invocation.
- `apps/server/src/lib/replay-metrics.ts`: remove inferred learner and fabricated/capped WPM; interruptions unavailable.
- `apps/server/src/routes/replay.ts`: authoritative adapters/endpoints, uploads/analysis/selection/progress/cache/delete serialization, cache reuse, permission enforcement.
- `apps/web/src/hooks/useReplaySession.ts`: nullable metrics and evidence response contract.
- `apps/web/src/pages/ReplayResults.tsx`: incremental evidence panel, safe cards/PDF/JSON/Pulse inputs, cancel obsolete loads; existing content review, meeting summaries, tabs, exports and re-analysis retained.

New implementation files:

- `apps/server/src/lib/replay-word-evidence.ts`
- `apps/server/src/lib/replay-evidence.ts`
- `apps/server/src/lib/replay-recording.ts`
- `apps/server/src/lib/replay-result-view.ts`
- `apps/web/src/components/replay/evidence-contract.ts`
- `apps/web/src/components/replay/ReplayEvidencePanel.tsx`
- `apps/web/src/components/replay/clip-playback.ts`
- `apps/web/src/components/replay/evidence-report.ts`

New tests/fixtures:

- Server: `replay-evidence.test.ts`, `replay-evidence-routes.test.ts`, `replay-workflow-evidence.test.ts` under `apps/server/test/`.
- Web: `clip-playback.test.ts`, `evidence-report.test.ts` next to the Replay implementations.
- Browser-only synthetic fixtures: `apps/web/test/replay-playback.html`, `replay-evidence-panel.html`, `replay-evidence-fixture.tsx`. These are not production build entrypoints.

## Migration and legacy interpretation

Migration: `apps/server/prisma/migrations/20260926000100_replay_delivery_evidence/migration.sql`:

```sql
ALTER TABLE "ReplaySession" ADD COLUMN "learnerSelection" JSONB;
ALTER TABLE "ReplayResult" ADD COLUMN "deliveryEvidence" JSONB;
```

Schema validation and isolated client generation passed. **Migration not applied** to any database. Coordinator must test applying it to a disposable database, including old rows, before deployment. Schema change must precede running the new Prisma client against a database.

Old results with no versioned evidence remain usable for meeting-level content, but do not establish learner identity or measured pace. Old segment-only caches cannot certify word timing. No historical bulk transcription is initiated. Legacy non-nullable numeric columns still need a zero storage sentinel for unavailable measurements; Replay's public read adapter never displays that sentinel as a finding. New unconfirmed analyses also withhold personal score/signal JSON and preserve only meeting-level coaching. Global consumers must not read the old columns directly.

## API contracts

All endpoints are under the existing authenticated, Replay-feature-gated router. Ordinary users are owner-scoped; existing privileged support access is retained.

### `GET /api/replay/sessions/:id/results`

Preserves the result envelope and adds `evidence`. `result.wordsPerMinute`, legacy score display values, time share, interruptions, response time and other unsupported measures are nullable. `result.wordShare` is selected-speaker words / all transcript words × 100, not time share. Unattributed content notes have an explicit `feedbackScope`; personal sentences and delivery claims are filtered while unrelated content is retained.

Representative evidence (illustrative, not this user's recording):

```json
{
  "version": "replay-delivery-v1",
  "transcriptRevision": "sha256-of-speaker-text-sequence",
  "recording": {"uploadId":"file-id","signature":"sha256-of-file-bytes","duration":100,"timelineOrigin":"retained_media_seconds"},
  "identity": {"state":"confirmed","speaker":"spk_1","revision":"selection-revision"},
  "source":"aws_batch",
  "accuracy":"not_human_validated",
  "acousticIsolation":"unknown",
  "overlapDetection":"unknown",
  "state":"available",
  "reason":null,
  "coverage":1,
  "eligibleWords":40,
  "excludedWords":0,
  "pace":{"wpm":120,"status":"available"},
  "moments":[{
    "id":"signature-selection-word-boundary-digest",
    "kind":"word_gap",
    "start":2.5,
    "end":6.3,
    "gapSeconds":0.8,
    "wordIds":["w7","w8"],
    "description":"0.8-second gap between transcribed words.",
    "limitation":"This is a model-timed word gap, not verified silence or a judgment of pause quality."
  }]
}
```

Also supplies `speakers: [{speaker, excerpt, preview: {start,end} | null}]`, `measurement`, `limitations`, and `supplementaryTranscript: {revision,status} | null`. Raw provider words are not included in the public results API. Machine reasons include `word_timing_missing_or_legacy`, `word_evidence_malformed`, `word_transcript_mismatch`, `transcript_revision_mismatch`, `media_duration_unavailable`, `confirm_learner`, and `provider_stream_incomplete`.

Export restrictions strip protected transcript, excerpts, commentary/annotations and coaching from public responses. Audio restrictions are independently enforced by the media endpoint. Stored file paths are never returned by these endpoints.

### `PUT /api/replay/sessions/:id/learner`

```json
{"speaker":"spk_1","transcriptRevision":"current-revision","recordingSignature":"current-signature-or-null","selectionRevision":null}
```

Use the current `identity.revision` for subsequent selections; use null when confirmation is absent/stale. On success returns `{code:200, selection:{speaker,transcriptRevision,recordingSignature,revision,provenance:"user_confirmed"}}`. Exact known label required. Stale input returns 409; unknown label 400; other owner 404. An identical current confirmation is idempotent. A changed mapping clears personal score/signal/coaching data and Replay Pulse rows under the session lock, but preserves meeting summaries. Confirmation never invokes transcription. A subsequent explicit re-analysis can reuse the current cache to generate personalized content feedback.

### `GET /api/replay/sessions/:id/media/:uploadId`

Authorized binary retained recording, private/no-store, with Express range support. Requires matching current recording upload ID and byte signature. Enforces owner, hide-audio restriction, audio Pro/Ultra or video Ultra access (existing admin policy retained). Changed bytes return 409. The browser requests using its ordinary auth header, obtains a private Blob URL, and cancels/revokes on navigation/selection change. No public S3 or filesystem URL.

Clip bounds are seconds on this recording, not on a concatenated transcript. The controller waits for metadata and seek completion, never skips gaps, stops via 25 ms timer/timeupdate, cancels on hidden page/unmount, and handles readiness errors/blocked autoplay. Context playback is a separate bounded action (three additional seconds each side). Browser behavior is tested, not ASR timing accuracy.

### `POST /api/replay/sessions/:id/track-progress`

```json
{"selectionRevision":"current-selection","transcriptRevision":"current-transcript"}
```

No client scores accepted. Reads current safe scores under the session lock, verifies evidence revisions/completed status, uses the persisted meeting date, excludes unavailable pacing/acoustic scores, and replaces this Replay session's entries idempotently. Returns `{code:200,tracked:5}` (count varies). Missing meeting date 400; stale/unavailable personal assessment 409. Uses existing shared score-to-Pulse mapping; does not duplicate or alter the global scoring engine or historical aggregation.

## Evidence definitions and invalidation

- `spk_0` and all other diarization labels are anonymous. Neither name matching nor dominance proves learner identity. Even one speaker needs confirmation.
- Provider pronunciation items retain their actual nullable recognition confidence. Confidence is not a timing/identity/isolation guarantee. Punctuation appends to display text without a duration.
- Batch labels join by validated numeric word boundaries or consistent direct labels, not array position. Conflicts become unassigned. Missing/non-finite/out-of-bounds/out-of-order word times are rejected; known overlaps are excluded locally.
- Displayed words/labels must lexically match the retained normalized provider sequence. Uploaded/corrected/cue words do not receive borrowed AWS times. ASR remains the primary text when available, retaining baseline source precedence; differing supplemental text is explicitly marked `different_not_aligned`.
- Pace is total accepted words / total accepted learner-stretch seconds × 60. Internal gaps remain in the denominator. Other speakers, known overlap, and gaps >=2 seconds split stretches. Other-speaker speech inside an apparent word gap also splits a stretch even if provider items are speaker-grouped.
- Eligible stretches require >=8 words, >=4 seconds, and 40–300 WPM. Shared aggregate assessment additionally requires >=2 accepted stretches, >=20 accepted words, >=85% accepted-word coverage, >=95% valid-timestamp coverage and no estimated timing samples. Incomplete provider streams cannot establish aggregate pace. These are conservative structural gates, not empirically certified thresholds.
- Factual moments require >=8-word accepted learner stretches and gaps >=0.6 but <2 seconds; up to five are shown. Absence of a transcribed word is not proof of acoustic silence. Unknown overlap remains unknown even when no timestamp collision is observed.
- Cache key includes audio byte signature, upload identity, transcription configuration and parser version (`replay-words-v1`). Transcript revision and analysis selection revision bind persisted display eligibility. Changed audio/config/version cannot reuse the prior cache as current. Valid same-input words are reused; no second transcription is made merely to display delivery.
- Recording duration comes from bounded ffprobe (5 seconds), never file/session elapsed guesses. Missing duration means unavailable delivery.
- Upload acceptance, processing claim/reset, learner selection, progress writes, cache writes and deletion coordinate through a ReplaySession row lock. File cleanup on rejected uploads and session deletion remains local; cache cannot be rewritten after its session was deleted. This is tested with mocked transactions, not a real concurrent PostgreSQL load test.

## Validation run

From the worktree root unless noted:

```sh
npm --workspace apps/server run build
npm --workspace apps/server test
npm --workspace apps/web run typecheck
npm --workspace apps/web run lint
npm --workspace apps/web run build
git diff --check
```

- Server build passed; full suite **258/258 tests**, 33 files.
- New Replay provider/evidence/route/workflow tests: **27 tests** across three files, plus existing Replay access tests.
- Web typecheck/lint/build passed. Existing dependency-data freshness and large-bundle warnings remain; manifests are intentionally unchanged.
- From `apps/web`: `../../node_modules/.bin/vitest run src/components/replay/clip-playback.test.ts src/components/replay/evidence-report.test.ts`: **8/8**.
- Prisma validate passed using a dummy local database URL; no database connection or migration execution.
- First full suite run failed because an existing Elevate resolver test assumed `apps/server/audio_storage` exists. Creating that isolated scratch directory made it pass. No shared resolver/test source was changed.
- Synthetic browser fixture on local-only port 5189: exact start **0.5 s**, samples inside the generated one-second silent gap, stopped **2.51794 s** for a **2.5 s** clip end (**17.94 ms overshoot**, target <=250 ms), paused=true. Keyboard Enter activation worked.
- Actual ReplayEvidencePanel rendered against a local synthetic fixture: keyboard Space selects `spk_1`; Enter confirmation updates the confirmed label and retains unavailable pace with explanatory copy. No production API requests.
- Unit tests cover navigation abort, hidden-page pause, metadata/seek readiness, invalid clip bounds, blocked autoplay and timer cleanup. Report tests ensure legacy values are not revived and restricted transcript stays absent.
- Workflow test covers text-only content, audio+conflicting text, explicit learner confirmation, same-cache re-analysis with exactly one mocked transcription call, unauthorized/rejected uploads and local cache/file deletion.
- **No real-audio evaluation, human-labelled corpus, real AWS call, authenticated production UI test, physical hearing assessment or database concurrency/migration test was performed.**

## Coordinator integration requests — required before production rollout

1. **Global Pulse write path:** `apps/server/src/routes/progress-pulse.ts::recordProgressPulse` still permits legacy clients to submit arbitrary Replay entries and does not use this revision/owner-locked adapter. Route Replay writes to the new server-derived path (or reject them and return the new endpoint). Audit the global skip path's owner/session locking as well. Do not trust client supplied scores/revisions as certification. Decide explicitly how to exclude/annotate historical unattributed Replay Pulse records; no historical data was rewritten here.
2. **Coach result interpretation:** `apps/server/src/routes/coach.ts::summariseReplaySession` reads `wordsPerMinute`, scores and coaching from stored legacy columns. Adapt it to `replayResultView(replay.result, replay.learnerSelection)` and pass its nullable pace/current scores/coaching. Otherwise old estimated WPM, storage zero sentinels or wrong-speaker findings can reappear through Coach despite safe Replay UI. This file is outside the requested write scope.
3. **Shared model prompt:** `aws-bedrock.ts::analyzeTranscript` still guesses a primary speaker by role when no participant is supplied. Replay suppresses personal findings at output until confirmed, but the coordinator should add an explicit meeting-only analysis mode so generation itself does not guess attribution. Existing content is not silently reassigned on speaker changes.
4. **Migration/integration rehearsal:** apply the two-column additive migration to an isolated database; generate the combined client once after reconciling with Elevate's branch; exercise concurrent confirmation/upload/process/delete/Pulse operations with real row locks. Add signed-in authorized audio/video/export restriction checks before rollout.
5. **Human accuracy gate:** collect consented, de-identified meeting examples with reviewed word boundaries and speaker identity. Evaluate timing/diarization failure modes across capture setups before claiming verified moments or changing thresholds. Mixed speaker-labelled audio is not isolated audio. No voice/personality/emotion/competence inference should be enabled by this patch.

No shared PDF engine or global route registration change is required: Replay owns its report adapter and the existing router already supplies authentication/feature gating. Historical global Pulse content is deliberately omitted from the new PDF inputs until its provenance is corrected.

## Remaining operating risks / rollout and rollback

- Existing Replay processing remains in-process asynchronous work. Server restart can strand `transcribing`/`analyzing`; no durable worker or recovery lease was introduced. This limitation must be handled operationally or assigned separately, not hidden behind a permanent evidence-pending state.
- Browser authenticated playback currently buffers the retained file as a Blob. Large meetings (up to existing upload limits) can have slow start/high memory use. Test maximum-size files; a future authorized streaming transport must preserve the same restrictions/signature/clip behavior.
- One-label selection may exclude other parts of the same person's speech. No auto-merge identity heuristic.
- Local deletion is not a claim of S3/AWS job-copy erasure. Existing S3/transcription lifecycle and retention policies require a separate review. No provider or retention expansion was introduced.
- Word-gap thresholds, ASR boundaries, transcript filler/sentence heuristics and inherited text scores are not human-calibrated delivery judgments. Acoustic isolation/capture metadata remain unknown.
- Unavailable/coarse timing can yield no pace or moments even with substantial speech. Do not substitute articulation/whole-meeting duration to improve coverage.
- Review R1 and R2–R4 separately. Roll out honest unavailable states first if integration/accuracy gates for clips need more time. There is no new global feature flag in this worktree.
- Keep additive nullable columns on code rollback; do not reset or destructively drop evidence. Rolling back to old UI/server code can restore misleading legacy presentation, so prefer a coordinator-controlled feature rollback with honesty fixes retained.

This handoff is ready for coordinator review and isolated integration validation. It does **not** certify production readiness or authorize deployment.
