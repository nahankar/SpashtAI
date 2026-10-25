# Phase 3.3a — Saved-answer learner evaluation

Implemented on `codex/interviews-phase3.3a`, from `b881296`.
The separate compatibility commit is `2e0992f`.

## Compatibility checkpoint

The API accepts legacy scalar selections or arrays. It trims, deduplicates and
sorts choices. Runs retain the existing `|` representation. The additive
`20261025010000_interview_selection_contract` migration validates each track,
experience and difficulty token rather than rejecting joined difficulty strings
or applying a single-track length limit to an entire selection. Tracks permit
20 values of up to 160 characters, matching the bank's track field; experience
and difficulty accept only their four supported values. Empty, duplicate or
unrecognized stored values fail database validation. No old run is rewritten.
Setup reads its question cap from the server rather than hardcoding the UI cap.

## Learner evaluation contract

`interview_adaptive` is a new selected-user capability, hidden and disabled by
default. This checkpoint uses it for technical evaluation only. Automatic voice
handoff and adaptive question selection remain 3.3b/3.3c. New enabled runs pin
`evaluationPolicySnapshot`; old runs keep NULL and are never retrospectively
queued. A later flag change cannot turn a capture-only run into an evaluated run.

Finish saves the existing immutable provider-final answer snapshot and queues a
single LIVE_ATTEMPT assessment in the same Session/Run transaction. Retry Finish
reuses the snapshot/job. Skip and incomplete closure do not create a grade.
Quota exhaustion produces a failed evaluation status without rolling back or
truncating the saved answer. Pinning uses the existing Nova 2 Lite configuration;
all grading still uses the captured question's actual track/level/guidance.

The source-specific learner worker reuses the evaluator's model client and
schema/evidence validation. It cannot claim ADMIN_TEST jobs. Admin routes and
worker remain source-restricted, and disabling Admin tests does not disable
permitted learner work. Learner limits are 30 invocations/user/UTC day, 300
global/day, two concurrent learner jobs, two attempts/job. Admin and learner
claims share the provider claim lock and retain separate concurrency ceilings
(at most two each). Retries reserve budget and append content-free usage to the
same logical job. Expired leases fail explicitly; late results cannot overwrite
a newer lease or publish after discard/revocation.

The regular worker returns immediately while the learner capability is off.
Administrative disabling or grant revocation cancels queued/running learner
jobs. Claim/publication recheck saved source, pinned policy, flags/grants and
session availability. Completed answers can finish evaluation after normal End;
discard still fences publication. Content-free usage survives deletion with its
assessment link cleared. The existing hourly budget retention worker also covers
the learner-prefixed counters.

No database Decision or generation-job table is added yet: those belong with
the actual adaptive producer in 3.3c. No bank versioning, automatic generated
question publication, Pulse contribution or numerical composite score is added.
The eight-attempt pilot cap remains unchanged in this checkpoint; replacing it
with duration-first practice needs its separate run/attempt policy migration.

## Policy versions and pinned runs (acceptance checkpoint)

Learner grading policies are frozen entries in `LEARNER_POLICIES`
(`evaluator/contracts.ts`). A new evaluated run pins `{ version, config }` from
`CURRENT_LEARNER_POLICY`; every job for that run is evaluated with exactly that
registered config, prompt text and parse rules, never with whatever is current.

- `learner-evaluation-1` is byte-identical to the config pinned before the
  registry existed (hash `a0c031d3…`, prompt `interview-answer-4`). Runs pinned
  to it keep that behaviour, including the post-model abstention override.
- `learner-evaluation-2` (prompt `interview-answer-5`, rubric `bank-guidance-2`,
  schema `interview-result-3`) is registered for calibration through the Admin
  preview. It treats answers as speech transcripts, passes the bank's labelled
  sections as separate rubric fields, ignores follow-ups, rejects grades whose
  classification contradicts their criteria and answers an explicit "I don't
  know" deterministically without a model call or budget.
- Prompt text is registered by ID and frozen by sha256 in tests. Never edit an
  entry or prompt in place: add a version and move `CURRENT_LEARNER_POLICY`.
- A pinned policy this code does not recognise, or one whose stored config was
  altered, never aborts Finish. The answer commits and its assessment is
  `CANCELLED` with `EVALUATOR_POLICY_UNAVAILABLE`, using no budget.
- Claim cancellations are distinct: `SESSION_DISCARDED`,
  `EVALUATOR_POLICY_UNAVAILABLE`, `CONFIG_MISMATCH`, `ATTEMPTS_EXHAUSTED`,
  `PILOT_ACCESS_UNAVAILABLE`.
- A usage row is written at claim (`STARTED`, unknown tokens). Lease expiry and
  Admin cancellation close it as `LEASE_EXPIRED`/`CANCELLED`; a late finish
  records the actual usage. Lease expiry locks and re-checks rows, so a result
  committed meanwhile is never overwritten.
- Validation failures record content-free reasons (`INVALID_OUTPUT_JSON`,
  `INVALID_OUTPUT_SCHEMA_<field>_<code>`, `INVALID_OUTPUT_INCONSISTENT`, …) and
  provider stop reasons (`INCOMPLETE_OUTPUT_MAX_TOKENS` and similar).
- Open answers in an evaluated run report `AWAITING_ANSWER`; `NOT_ENABLED`
  is reserved for capture-only runs.

Admins can preview `learner-evaluation-2` on the accounted Admin test path
(no adaptive next step, its own input key). `learner-evaluation-1` is not
offered separately because it is identical to the `nova2_lite` Admin config.

## Owned report endpoints

- `GET /api/interviews/runs/:runId/assessments`
- `GET /api/interviews/playback/:sessionId/assessments`

Both require the session owner, including for Admin/Super Admin callers. They
remain available for saved history after execution access is withdrawn. The
response is `{ assessments: [...] }`, ordered by attempt index. Entries contain
attempt ID/index, the actual question, status/error code, after-example marker
and a sanitized result: classification, criteria/evidence, strengths, gaps,
misconceptions, guidance and uncertainty. No private question snapshot, grading
prompt/configuration, model raw output, hashes or generated follow-up proposal
is returned. Transcript-hidden accounts receive no question/result text.

Practice and playback show pending, completed, failed or cancelled evaluations.
The shared communication player, All default, word highlighting, gap skipping,
Skip badges and direct history Review links are preserved. Reports poll pending
work, abort on navigation and never pretend a failed model call produced a grade.

## Verification and local simulation

PostgreSQL integration tests cover long/multiple selections, old runs,
idempotency, immutable inputs, owner/privacy boundaries, separate sources,
quotas, retries, lease fencing, abstention, discard and normal End. Fresh and
upgrade migrations are checked separately. UI/typecheck and production builds
are included in the checkpoint checks.

The repository-local Postman simulation models only the Bedrock Converse path
used by the SDK. Its fixed findings are transport fixtures, not calibration or
proof of technical grading quality. No vendor-owned mock was supplied locally;
the fixture follows the installed SDK's request/response contract. It is local,
not published to a Postman workspace.

Start it with:

```sh
postman simulation run postman/simulations/interview-evaluator.sim.yaml --port 4901 --no-history --output ndjson
```

Then run the integration tests with
`INTERVIEW_EVALUATOR_TEST_ENDPOINT=http://127.0.0.1:4901/bedrock` and the isolated
`BANK_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55441/simple_bank`.
The model client accepts this endpoint only in NODE_ENV=test and only at a
127.0.0.1 HTTP address. It uses fixed dummy credentials and HTTP/1 for this
simulation; production retains the AWS SDK's normal transport/credential chain.
The exercised cases include success, invalid JSON, throttling and model timeout.

For a localhost human pilot, grant Interviews, Interview voice and Interview
technical evaluation to the selected tester, enable the capabilities and start
a new practice. Finish an answer, then open Review; technical findings appear
when the job completes. Existing manual runs remain capture-only. Real AWS
quality/latency calibration and human microphone behavior still need pilot
verification before enabling learner evaluation in production.

## Voice and playback corrections validated for release

- Expiry blocks another question but leaves the current answer recordable,
  including a resumed practice with no time remaining. Saving still mutes input.
- Delivery extraction uses the existing bounded WAV conversion for browser
  recordings, cleans temporary files after errors, and excludes acoustic windows
  too short for Praat without inventing pitch measurements.
- A missing aligned answer gets a bounded retry between already verified
  neighboring words. Retries preserve segment clocks and existing results,
  stop at three windows per segment, and never fill unmatched words synthetically.
- Elevate and Interviews share playback fallback regions. Partial alignment
  retains audible answers; complete verified timing skips coach-time gaps and
  retains every word cluster around long pauses. Toggling Skip gaps during
  playback preserves the playing state. Selected evidence clips retain pauses.

Release verification: 568 server tests passed with four simulation-only cases
skipped; 273 web tests and 44 focused Python audio/voice tests passed. Typechecks,
lint of changed web files, and server/web production builds passed. A local
recording was reprocessed to verify all four answers, including a recovered
63-word answer; HTTP playback checks verified the exact gap-seek targets.
Real AWS technical evaluator calibration remains outside these audio checks.
