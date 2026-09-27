# Automatic delivery alignment

Completed Elevate sessions now queue word alignment without the user's manual
Reprocess permission. Leave, committed late turns, and successful browser upload
retries wake the durable queue. The minute sweep processes one session per tick.
One database lease limits automatic alignment to one session across API replicas;
the existing manual Reprocess pipeline is separate. Jobs have
a 15-minute subprocess deadline, a 20-minute lease, exponential retry delay and
five attempts before an explicit unavailable state. New inputs wake unavailable
jobs. API restarts recover expired processing jobs.

Deploy the Prisma migration before starting the updated API. The migration does
not queue existing sessions in bulk. An explicit Reprocess request also queues
an old session. `AUTO_DELIVERY_ALIGNMENT_ENABLED=false` pauses new worker runs;
the default is enabled. The worker requires the agent Python environment,
ffmpeg, and Gentle reachable via `GENTLE_URL` (default localhost:8765).
The existing Gentle service can be started with
`docker compose -f infra/gentle/docker-compose.yml up -d gentle`.

This is a dedicated alignment pass. It does not run the content analyser, LLM
coaching or manual reprocess pipeline. It stores words in a separate result,
with audio, transcript and Replay-timeline signatures. Complete browser user
recordings are required; composite audio is rejected. Each segment is aligned
separately and Gentle character offsets assign words to committed turn IDs.
Every accepted turn requires complete matching words, finite ordered times and
segment containment. A missing word suppresses that turn rather than inventing
a timestamp. Changed input and discarded-session results cannot be committed.
Before alignment and again under the commit lock, committed user words must
match the full saved user transcript. Different turn boundaries are allowed,
but missing or changed content keeps the job waiting. A late transcript update
wakes the queue and invalidates the previous alignment; identical retries do not.

Replay and Delivery Moments overlay current validated results on the original
turns. Pace uses the elapsed span from first word to last word of each accepted
turn, including pauses within that turn, excluding coach/inter-turn gaps. It
retains the existing minimum turn, duration, word and coverage requirements.
Missing/partial evidence cannot become a headline score. Late input invalidates
alignment-derived pace until reconciliation. Acoustic interpretations remain
experimental and the existing Delivery Moments feature flag still controls them.
The worker and subsequent analytics requests share the canonical pace resolver,
using the same accepted samples for rate and variability. Analytics rereads the
alignment under the session lock so a job completing during analysis is retained.

Results show background progress independently of manual Reprocess access.
Completion offers “View updated results” without interrupting current playback.
Polling stops after 20 minutes of elapsed time; each request, including its
response body, has a 15-second timeout. The server continues independently.
When retries are exhausted, missing audio or transcript evidence is reported as
unavailable consistently in both the progress banner and Delivery Moments.

## Live timing is source evidence, not a recording clock

The agent retains supported final word evidence under
`SessionTurn.metrics.live_word_evidence` with version `elevate-live-words-v1`.
It includes the configured provider, words and source times, genuine recognition
confidence when supplied, and an explicit `source_only` or `unavailable` state.
`clock` is `stt_stream` and `mapping` is null. Missing capability, incomplete
lexical matches and ambiguous source fragments are not filled by interpolation.

The pinned LiveKit agents/AWS 1.5.8 SDK already exposes timed words as
`SpeechData.words` containing `TimedString` instances. Their text is `str(word)`,
not a `word` or `text` attribute, and the SDK has already applied
`start_time_offset` to the endpoints. The collector reads the public fields and
does not apply that offset twice or replace the provider. The high-level
`UserInputTranscribedEvent` does not carry those words.

AWS result/stream identities are not propagated through the pinned plugin's
`SpeechEvent`; the collector does not invent them. Each new agent STT-node
invocation starts an anonymous source epoch. Offset changes and regressing times
also separate epochs. The plugin can hide a reconnect with identical content and
clock values; that ambiguity is another reason not to certify recording timing.
The SDK turns missing recognition confidence into zero. That ambiguous
`TimedString` zero is omitted; an explicitly supplied dictionary confidence of
zero is retained as source data.

Backend behavior:

| Configured backend | Source-word capability | Recording evidence |
| --- | --- | --- |
| Transcribe pipeline | Public timed words retained; exact lexical matching | Used when the STT sample envelope correlates with the retained recording; otherwise automatic alignment |
| Whisper pipeline | Retain timed words only if supplied; text/chunk-only timing is unavailable | Automatic alignment fallback |
| Nova Sonic | No STT-node word events in the current speech-to-speech path | Automatic alignment fallback |

Source extraction runs alongside the existing live pace ingestion and yields
the original events unchanged. Its failure must not drop a coach transcript or
change the voice backend.

Example internal per-turn source metadata (not returned in public turn metrics):

```json
{
  "version": "elevate-live-words-v1",
  "provider": "transcribe",
  "state": "source_only",
  "reason": "unanchored_stt_stream",
  "clock": "stt_stream",
  "words": [
    {"w": "hello", "start": 10, "end": 10.4, "recognitionConfidence": 0.95}
  ],
  "mapping": null
}
```

Partial source words can be retained with a reason such as
`incomplete_word_timestamps`; they are still not recording evidence. A turn
crossing source epochs, an ambiguous repeated phrase, or missing word data is
reported explicitly rather than attaching the next available words to it.

Turn uploads are split into idempotent requests of at most 96 KiB, measured
with the same JSON serialization as the HTTP client, beneath the API's 100 KiB
body limit. Stable local turn indexes and committed text are preserved. If one
turn's optional word metadata is too large, it is withheld with reason
`source_payload_limit` and a warning instead of causing the entire upload to
fail. A single committed turn that still exceeds the limit without source words
raises an explicit error; its text is never silently truncated. Alignment waits
for the complete committed transcript while batches arrive.

The old callback-time-minus-finalization-lag estimate is no longer emitted by
the agent. It cannot establish correspondence between the STT stream and the
browser's independently encoded recording, especially after reconnects. Legacy
agent offsets remain approximate playback data only. The server does not accept
a caller-provided "verified" mapping or a client `actual` word-origin label as
proof of recording-clock accuracy. `actual` is applied only by the server after
the stream envelope correlates with the retained recording.

Public turn responses strip the internal source-word metadata (including when
transcript text is restricted). Stored source words stay approximate until that
signature-bound overlay is applied. The same rule covers Delivery Moments and
manual Reprocess. Source-only words are not exact evidence clips.

Existing live duration-based pace remains governed by the existing pace policy;
it is not by itself evidence for where a word occurs in a saved recording. A
validated, current cached alignment is reused without another subprocess when
its audio, transcript, timeline and, for live results, stream-clock signatures
still match. Corrupt cached results are explicitly rejected and recomputed.

After automatic alignment, `processingStatus.deliveryTiming` reports:

```json
{
  "state": "partial",
  "source": "forced_alignment",
  "acceptedTurnCount": 2,
  "totalTurnCount": 3,
  "liveSource": {
    "sourceOnlyTurns": 2,
    "unavailableTurns": 1,
    "recordingClockMapped": false
  }
}
```

When the live clock is accepted for every turn, `source` is `live_recording_clock`,
`state` is `complete`, and `recordingClockMapped` is true. A session that keeps
live timing for some turns and alignment for the others uses `source` `mixed`.
Partial Gentle coverage stays distinguishable from a fully live result.

`complete` here means that every committed user turn passed the alignment
checks, not that a human certified every boundary. A partial result can provide
eligible moments while failing the stricter aggregate pace requirements.
Requeueing removes this summary until current inputs have been processed.
The metrics endpoint also returns a sanitized `deliveryAlignmentError` reason
for user-facing status; filesystem paths and arbitrary subprocess errors are
not exposed through that field.

Live timing replaces Gentle only after a sample-envelope correlation. The agent
records a 20 ms RMS envelope of the audio frames actually pushed into each STT
stream. The server correlates that envelope with each retained recording
segment. Word times are the provider's stream-local times (reported time minus
the SDK `start_time_offset` that was already applied) shifted by the correlated
lag. Callback arrival, a guessed constant lag, and wall-clock differences
between the browser and the agent are not used.

The lag is accepted only when the normalized correlation is at least 0.55 and
beats every other alignment by at least 0.12. Each turn is then mapped on its
own: hyphenated words may be one timed item or a few adjacent items, and one
or two unmatched transcript words do not drop the rest of that turn. A turn
that still fails stays with Gentle. Pause and
resume are separate recording segments correlated against the same or a later
stream. A new `stt_node` invocation is a new epoch and can align inside a later
segment, including a reconnect that starts at a different point in that
recording. An offset change inside one stream drops that envelope and keeps
Gentle, because the restarted provider clock has no sample anchor.

Accepted live results use version `elevate-recording-clock-v1`, word origin
`actual`, and `deliveryTiming.source` `live_recording_clock`. They are bound to
the recording, transcript, timeline and stream-clock signatures. A change to
any of those drops the overlay. Turns the live clock does not fully time still
go through Gentle, and the verified words from both sources are kept together.
This correlation is not a human-labelled accuracy
certification.

## Acceptance before release

1. Apply the migration to the test database and start API, agent signal API and
   Gentle. Record a new session with three substantive responses and a pause/resume.
2. Leave and switch result tabs while alignment runs. Verify pending then completed
   status, accepted words attached to their original turn IDs, and no duplicate job.
3. Refresh results. Verify weighted pace against accepted first/last-word spans;
   play a delivery moment on the second segment and verify the exact recording
   offset and audible pause with Skip gaps enabled.
4. Stop Gentle for a new session; verify durable retry and eventual unavailable
   copy. Restart API during a job; verify recovery after lease expiry.
5. Test a delayed upload, changed transcript, and discard during alignment. No
   stale or discarded result should be served or committed.

Automated tests validate the mapping, job lifecycle and API handoff using test
alignment output. They do not establish real-world alignment accuracy or coaching
calibration. Human-labelled holdout evaluation remains an independent requirement.

## Implementation handoff

This work is isolated on `feature/elevate-live-delivery-evidence`, based on
`04aa9f2`. It does not change schema/migrations, dependencies, feature flags,
Replay product files, shared score/Progress Pulse logic, or the shared PDF
renderer. Existing report inputs continue to use the canonical pace path.
No batch transcription, new speech provider, calibrated acoustic claims, or
production feature enablement is added.

Validation:

- 61 Python tests: source collector, real pinned SDK objects, actual
  `CoachingAgent.stt_node` wiring, bounded turn uploads, source epoch changes
  and live pacing.
- 139 affected server tests across 19 suites: provenance/clock gating, private
  source metadata, word alignment, pace, recording resolution, retries,
  stale-input rejection, manual reprocess and discard behavior.
- All 78 web tests, web typecheck, ESLint and production build passed.
- Server TypeScript build passed.

Python integration tests disable the in-process signal service and use mocked
provider streams with actual public SDK event objects; they do not contact AWS.
Playback-controller tests use controlled media clocks, including the skip-gap
race at the selected clip end. The controller clamps the media clock before
clearing the clip and uses a 50 ms watcher; browser scheduling can still be
throttled, so this is not a real-browser latency guarantee.
Evidence buttons, timeline markers and automatic clip requests wait for usable
metadata from the current session's recording. Indefinite WebM duration probes
are cancellable, time out after ten seconds, and cannot reset a later evidence
seek. Polling tests cover hung requests/bodies, elapsed deadlines and cancellation.

The remaining release gate is an authorized end-to-end recording acceptance
pass, including resumed segments and human-checked clip boundaries. Removing
Gentle is separately gated on a defensible live-to-retained-audio sample-clock
mapping. Neither synthetic fixtures nor the SDK's word confidence establishes
that mapping.
