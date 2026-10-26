# Phase 3.3 — Conversational, adaptive interview practice

Plan date: 14 October 2026. Reviewed against GitHub/EC2 baseline `3913037`
(including Cursor's analytics deployment) and interview review fix `a45839c`.
This document is an implementation plan, not a claim that adaptation is live.

25 October checkpoint: the compatibility correction and saved-answer learner
evaluation are implemented separately on `codex/interviews-phase3.3a`, based on
`b881296`. See [the implementation and verification contract](./INTERVIEWS-PHASE-3.3a-IMPLEMENTATION.md).
Learner evaluation is default-off; automatic conversation and generated
follow-ups remain later checkpoints. The eight-attempt cap is unchanged here.

## Product outcome

The interviewer asks a question, listens to a complete answer, gives brief
grounded feedback when available and asks a relevant next question. Finish answer
and Next question become optional controls. Pause, Skip, End and explicit
completion remain available. Thinking pauses must not become separate answers.

Correct answers can lead to deeper/harder questions; partial answers lead to one
specific probe; incorrect answers lead to a simpler prerequisite; explicit lack
of knowledge leads to another topic. Unknown model results never imply an
incorrect answer. Interview findings remain separate from communication feedback
and Progress Pulse. Standalone runs keep context within that run.

Keep the single editable question bank. Immutable attempt question/guidance and
answer snapshots preserve what happened in a session; this does not reintroduce
editorial question versioning. Do not rewrite historical answers or grade older
manual sessions automatically.

## Findings from the latest code

| Existing implementation | Consequence for 3.3 |
| --- | --- |
| `useLiveSession`, controller/adapters, `LiveSessionRoom`, `ConversationPanel`, recorder and `SessionReplay` are shared with Elevate. | Extend these interfaces; do not build another microphone, recorder, transcript stitcher or player. |
| `interview_voice.py` uses `build_interview_session`; its Transcribe/Polly pipeline has `llm=None` and manual turn detection. | Removing UI buttons alone cannot produce a conversational interviewer. Add a server-directed coordinator while retaining durable capture. |
| `InterviewCapture` serializes provider-final STT chunks and produces matching drain receipts. | Automatic completion must use the same save barrier as explicit Finish. SDK-promoted interim text remains non-authoritative. |
| `finishAnswer` creates a `LIVE_ATTEMPT` snapshot but deliberately enqueues no assessment. | Enqueue the learner job atomically with snapshot creation for eligible new runs. |
| Evaluator submission, claim, result publication and budget checks currently accept only `ADMIN_TEST`. | Add source-specific learner access/quotas; do not simply remove the source checks or give learners Admin access. |
| Model config is `us.amazon.nova-2-lite-v1:0` in `us-east-1`; comparison is Nova Pro v1. | Use the configured Nova 2 Lite as the initial measured baseline. Nova 2 Pro is not configured; adding it requires verified access and a new configuration ID. |
| `adaptiveDecision` returns suggested wording, but not a complete question-specific rubric. Its Admin topic-switch selection lacks the learner provenance/experience constraints. | Do not call it unchanged as the live selection authority. Reuse classification mapping, add a learner-safe policy and selector. |
| Prisma includes `origin` and `parentAttemptId`, but SQL constrains `origin='BANK'` and parent to NULL. | An additive migration is required before storing generated follow-ups. |
| One assessment per snapshot and unique `inputKey` already exist. | Reuse these constraints and leases; one live and background consumer must share the same logical result. |
| Cursor records `practice_start`, `answer_completed`, `answer_skipped`, `run_completed` and `results_viewed` events. | Preserve these calls and event semantics during the refactor. Emit no candidate text into analytics. |
| Playback already uses grouped answers, validated word timings and a default All filter. Review now opens it directly and labels skipped questions. | Preserve this behavior for generated questions, feedback and future reports. |

## Decisions to fix before coding

1. **Run policy:** new default-off `interview_adaptive` capability, in addition to
   Interviews and Interview voice. Save an immutable policy snapshot at launch.
   Existing runs default to the existing manual policy and resume unchanged.
   Turning adaptation off stops new model work/automatic advancement, while
   owned history, recording, safe Finish/Skip/Pause/End and discard remain usable.
2. **Model:** begin with Nova 2 Lite, evaluate held-out answers and measure
   latency. Do not claim calibration based on successful JSON output. Evaluate
   a stronger model only after access is verified; changing model/prompt creates
   a new configuration ID for new runs, never silently regrades saved work.
3. **Limits:** retain 5/10/15 active minutes and eight total asked attempts for
   the first pilot. Follow-ups count toward eight. Permit at most two follow-ups
   per root question, one difficulty-step change at a time, with experience
   fixed. Prefer at least three root topics when bank coverage/time allow; do
   not promise that coverage for a sparse bank or five-minute run.
4. **Feedback:** one short specific technical observation followed by the next
   question. Avoid repeated scores, generic praise and long teaching during the
   interview. Detailed examples and Ask this session remain Phase 3.4.
5. **Latency:** target a final-answer-to-next-spoken-question p95 of eight
   seconds, with five seconds preferred. Measure drain, queue, evaluation,
   generation and TTS separately. This is a target to validate, not an existing
   guarantee. At eight seconds say that detailed feedback will be in the report
   and continue neutrally with an eligible bank question. Do not deepen or
   simplify using a missing/invalid/late verdict.

## 3.3a — Learner evaluation and durable decisions

Implement this before enabling automatic turns. It can first be exercised using
the existing Finish/Next controls to isolate evaluator behavior from endpointing.

### Database changes

- Add `InterviewRun.interviewPolicySnapshot` JSON with a legacy manual default;
  include mode, policy/config ID, endpointing policy and limits. Preserve the
  immutable run contract. Do not add mutable execution state to that row.
- Reuse `InterviewAnswerSnapshot`, `InterviewAssessment`,
  `InterviewEvaluatorUsage` and budget counters. Extend code configuration
  validation to explicitly support the new learner configuration. RECORDING
  remains reserved. Keep `textRevision=1` and the current exact-text owner
  trigger in this phase; any transcript correction/supersession needs its own
  explicit future contract.
- Add `InterviewDecision`: unique source attempt, optional assessment link,
  decision kind (`DEEPEN`, `CLARIFY`, `SIMPLIFY`, `SWITCH_TOPIC`,
  `CONTINUE_NEUTRALLY`, `END`), state, policy version, optional next-attempt link,
  safe brief feedback, reason, timestamps and leased generation fields.
  Enforce same-run links. Once a decision is consumed/next question prepared,
  its selection and feedback are immutable. A late assessment can update the
  report but cannot change that consumed decision.
- Session/account deletion cascades snapshots, decisions and jobs. Keep
  content-free accounting unlinkable after deletion. Make lock order consistent
  (Session, Run, Attempt/Decision/Assessment) and test deletion versus workers.
- Do not change question approval, activation or provenance during migration.
  Apply additive migrations; test both baseline initialization and upgrade.

### Service and worker changes

- Refactor `interviews/evaluator/service.ts` into shared invocation/lease/result
  persistence and separate Admin/learner policies. Keep Admin routes and limits
  behavior intact. Learner results are accessible only to their owner, including
  when an Admin or Super Admin tries a learner endpoint.
- For new policy-enabled runs, `finishAnswer` commits the exact assembled answer
  and creates one PENDING assessment in the same transaction. Include attempt
  identity, owner, source, question/answer hashes and immutable config hash in
  the idempotency key. Identical speech in another attempt is still a separate
  attempt, not a conflicting snapshot. No Bedrock request runs inside a DB lock.
- Add an internal progress endpoint and an owned learner assessment endpoint.
  Return status and a sanitized finding/evidence DTO, never private guidance,
  model prompts, raw provider responses or somebody else's answers.
- Learner and Admin claims independently check their own flag and grant at
  claim and publication. Capture-only sessions are not retrospectively queued.
  Revoked execution access cancels queued/live advancement; the user's saved
  completed findings and history remain readable.
- Use separate learner counters and a shared provider concurrency ceiling.
  Initial conservative pilot proposal: 30 learner model invocations/user/UTC
  day, 300 global/day, two concurrent learner invocations, at most two physical
  attempts/job. Generation and retries consume invocation budget too. Report
  actual token usage; missing usage is unknown, not zero. Tune only after pilot
  measurements. Reservations, retries and caps must be enforced transactionally.
- Voice awaits/polls the existing job, not a synchronous long-running endpoint:
  the current internal HTTP client timeout is five seconds. The live eight-
  second wait can expire while that one durable job continues to its bounded
  model timeout. Do not enqueue a second evaluation for the report.
- Explicit Skip produces a skipped outcome and no grade. Explicit "I don't
  know" can yield a deterministic abstention policy, without a false subject
  finding. End/discard cancels advancement; committed completed answers can
  finish report assessment after End when access remains permitted. Discard
  always fences persistence. Incomplete/empty answers receive no invented grade.

Acceptance: manual Finish creates one owned live-source job, duplicate callbacks
reuse it, disabled Admin evaluation does not block permitted learner jobs, and
the inverse does not expose learner work to the Admin worker or API.

## 3.3b — Natural turn coordination using the existing engine

> Superseded where different by the reviewed [3.3b plan](./INTERVIEWS-PHASE-3.3b-PLAN.md) (25 October 2026): new
> `interview_conversation` flag, a 5 s initial handoff window, an agent-owned coordinator with internal
> finish/next routes, and a replacement for the 8 s save wait.

### Reuse and patient completion

- Keep Transcribe, Polly, Silero, Hush when configured, room ownership, audio
  keepalive, recorder sealing and the existing `InterviewCapture` queue. Reuse
  `_pipeline_min_silence_duration` and the separation between short STT chunking
  and patient response endpointing. Leave Elevate's current defaults unchanged.
- Add a small interview coordinator in `apps/agent/interview_coordinator.py`.
  It owns listening, candidate-end, saving, waiting-for-result, preparing,
  speaking, paused and ended states. The server owns committed outcomes and
  next-question identity. No free-speaking LLM independently chooses a question
  or invents live feedback.
- Evaluate the installed LiveKit 1.5.8 end-of-turn hooks in an isolated spike.
  Patient endpointing exists today; a semantic turn detector is not installed.
  Start with a conservative interview-only 4-second minimum/6-second candidate
  handoff window, reset on renewed speech, plus incomplete-phrase protection.
  Calibrate against human thinking pauses before enabling automatic mode.
  These timings are a starting hypothesis, not a guarantee that a pause means
  completion. If long pauses still cause interruptions, add a compatible local
  semantic detector after dependency/latency validation, or keep manual mode.
- Never finalize on silence without substantive provider-final text. Do not
  impose a minimum word count that rejects a short correct technical answer.
  Renewed speech, pending STT or unresolved persistence cancels the candidate
  handoff. Uncertain endpointing waits; prolonged silence can offer more time or
  Skip, never a grade. An explicit Finish remains an immediate handoff request.
- Serialize automatic and manual Finish through the same coordinator lock and
  stable request ID. Both use the existing drain receipt and server finish
  contract. Do not use the SDK's promoted interim result as snapshot text.
- During saving/evaluation, show the actual state and microphone state. New
  speech before sealing cancels the candidate handoff. After a committed answer,
  do not silently append to or rewrite the graded snapshot; a learner correction
  is a new explicitly identified follow-up exchange. Test this boundary.

### Interruption, controls and reconnect

- Recognize restricted conversational intents in context: repeat the question,
  need more time, finished answer, Skip, Pause and End. Store these as control
  events, not technical answer chunks. Do not treat "skip lists" or an answer
  discussing pause/resume as a command. Ambiguous speech needs clarification.
- Add safe `InterviewConversationEvent` records for interviewer feedback,
  repeated question and explicit control acknowledgments, with run/attempt,
  stable event ID, sequence and timestamp. They are not answer snapshots or
  grading evidence. This avoids losing conversational feedback on refresh.
  Merge them with grouped attempt messages through the existing panel/projection;
  never insert fake user turns. Raw recording turns retain their separate clock.
- Pause/End/Skip buttons remain visible. Finish/Next remain optional fallback
  controls; a "Need more time" action suspends candidate completion for the
  current answer. Repeat does not create another attempt. Preserve consent,
  retention, browser recording and accessible keyboard controls.
- On resume, read server state before speaking: same unfinished answer resumes,
  an already prepared question is reused, a consumed decision cannot repeat,
  and a completed run opens playback. Reuse durable IDs for spoken messages.
  Existing manual runs retain their manual mode even after rollout activation.
- Fence stale agent segments and simultaneous tabs; one coordinator may advance
  a run. Reconnect/Pause/End racing with evaluation must not play a late reply
  into another question or closed room. Provider errors offer safe retry/End.

Acceptance: consecutive answers progress without required clicks; 2–4-second
thinking pauses stitch into one saved answer; long/uncertain pauses, background
noise and mid-sentence disconnect do not create phantom answers or feedback.

## 3.3c — Bank-first adaptation and grounded generated follow-ups

> **Status (26 Oct 2026): not started.** Grade-dependent adaptation and generated follow-ups stay deferred
> until grading acceptance (REASONING reliability, human microphone run, expert review). The branch
> `codex/interviews-phase3.3c-history-feedback` holds the 3.3b follow-up only (pilot grading findings,
> Interview history, inline playback feedback): see `INTERVIEWS-PHASE-3.3b-FOLLOWUP.md`.

- Add `interviews/practice/adaptation.ts` with one server-owned policy. It consumes
  a validated completed assessment; it never reads earlier standalone run
  answers/grades as context. Existing recent question-exposure avoidance remains
  allowed for variety.
- CORRECT: deepen the demonstrated concept or raise difficulty one step within
  the experience band. PARTIAL: probe one missing essential concept. INCORRECT:
  simplify a relevant prerequisite. NOT_ANSWERED: switch topic. Uncertainty,
  provider failure or exhausted budget: eligible neutral bank question, without
  asserted correctness or difficulty escalation.
- Every bank selection applies `learnerEligibleWhere`, namespace, track,
  experience, spoken suitability, approval, activation, provenance, repetition
  and time/attempt limits. Do not reuse the current Admin `adaptiveDecision`
  selector unchanged. Fallback order is another same-level topic, then an
  eligible simpler question, then normal completion. Do not silently widen
  experience or use unapproved content to fill coverage.
- Prefer a suitable bank question. If a meaningful probe is not available,
  generate a bounded follow-up package: exact question, intended concept,
  difficulty/experience, expected concepts, accepted alternatives, common
  misconceptions, expected depth, answer guidance and learner explanation/example.
  Pin the package to the parent snapshot and generation config/input hash.
  A changed concept requires its own guidance; parent rubrics are not copied
  blindly. Guidance validation is structural and consistency checking, not
  proof of factual correctness; calibrate actual packages in the pilot.
- Use versioned server prompts and strict schemas, size limits and injection
  defenses. Candidate speech and bank source text are untrusted. No tools/code
  execution or external actions. Keep candidate/company details out of generated
  question wording and shared learning content. Reject uncertain or malformed
  packages and fall back to the bank.
- Add a separate leased generation job, uniquely linked to the durable decision,
  for idempotent retries/accounting. It may be precomputed only after a committed
  answer; do not pre-grade unfinished speech. If generation misses the total
  live budget, consume a neutral bank fallback; the late package is never asked
  or added to the shared bank.
- Extend SQL attempt-state/ownership constraints to allow BANK with no parent
  and GENERATED_FOLLOW_UP with a same-run earlier parent, complete immutable
  guidance and no mutable bank link. Preserve one open attempt per run, eight
  total attempts, monotonic statuses and exact answered-snapshot ownership.
  Update `questionSnapshotSchema` with an explicitly compatible generated
  snapshot contract; never fabricate a bank ID/revision for generated content.
- Persist the decision, generated package and next attempt before speaking
  exact wording. Record exposure only after the asked acknowledgment. Do not
  convert an unasked draft into an answered question or a shared bank item.

Acceptance: held-out strong/partial/incorrect/abstention/alternative answers
produce justified next steps; no unsupported live verdict, duplicate follow-up,
unreviewed bank selection, false quotation or change to old session snapshots.

## 3.3d — Learner UI and minimum review

> **Status (26 Oct 2026):** Interview history and inline per-answer feedback were delivered early in the 3.3b
> follow-up. The rest of 3.3d depends on 3.3c and is not started.

- Extend `Interviews.tsx`, `InterviewControls.tsx` and shared status interfaces;
  do not copy Elevate page logic. Default new eligible runs to conversation mode
  only after pilot acceptance. Explain automatic handoff and optional Finish in
  one short line. Avoid showing required answer points as instructions that
  teach the answer before independent recall.
- Map real coordinator states to Listening, Saving answer, Preparing next
  question, Interviewer speaking, Paused and Ended. Ready/Listening cannot remain
  visible during saving or disabled input. Screen-reader announcements should
  describe state changes without announcing every STT fragment.
- Use the shared left/right conversation bubbles, whole-answer grouping,
  light-orange Skipped/Incomplete markers and server-backed conversational
  events. Include brief feedback only when its persisted assessment exists.
- Preserve direct history-to-playback Review and default All, manual scrolling,
  recording-bound word highlighting and measured gap skipping. New events get
  karaoke only when their exact recorded words have accepted timings.
- Add a compact owned per-answer findings section (accuracy/reasoning/depth,
  evidence, assisted status, pending/failed/unassessed). No numeric composite
  score, no global skill profile and no Pulse writes. Full technical teaching,
  examples and Ask this session remain Phase 3.4.
- Preserve Cursor's existing product-event contract and usage actions. Add any
  new lifecycle events only with matching governed analytics/Cube definitions;
  do not reclassify Interview events as Elevate because Session.module is
  `elevate`. Record content-free latency/failure counters separately from grades.

## Verification, pilot and deployment order

1. Commit 3.3a schema/source-aware evaluator and decision contracts. Test fresh
   and upgrade paths, owner/flag isolation, atomic idempotency, quota races,
   expired leases, End/discard/revocation and Admin regressions.
2. Commit 3.3b coordinator and optional controls. Use existing dependencies for
   unit tests; fake clock/provider final events cover thinking pauses, renewed
   speech at cutoff, delayed finals, automatic/manual races, repeated commands,
   segment resume and stale replies. No synthetic silence enters answers.
3. Commit 3.3c policy and generated packages. Test difficulty/experience bounds,
   coverage/repetition, eight-attempt/time limits, rubric mismatch, injection,
   exact evidence, generation timeouts and atomic same-run parent constraints.
4. Commit 3.3d UI/minimum findings. Typecheck/build and run targeted plus complete
   suites once the final implementation is stable. Verify live/manual Elevate,
   Prepare launch and interview playback regressions; preserve token parameters
   exactly `room`, `sessionId`, `segmentId`.
5. Calibrate on a manageable pilot: Automation Testing first, with Agentic AI
   and Business Analysis as cross-track checks. Use at least 20 held-out bank
   questions across Simple/Medium and 100 varied answers: correct, partial,
   false-but-fluent, abstention, terse alternative and adversarial examples.
   Human review must distinguish essential gaps from optional depth. Block
   rollout on severe false technical assertions or irrelevant generated rubrics;
   publish measured agreement and uncertainty rather than a "calibrated" label.
6. Real Polly/Transcribe test: eight consecutive questions; longer thinking
   pauses; repeat/Skip/unknown; Pause+Resume; refresh/disconnect; budget and
   provider failure; End while work is pending; recording review. Measure p50/p95
   from actual answer handoff to next speech, including generation and TTS.
7. Deploy the additive migration with adaptation off, preserving current
   flags/grants and question provenance. Check active voice before maintenance.
   Enable only a few selected users after acceptance. Rollback by disabling
   adaptation, preserving captured data and the existing manual experience.

Question-bank enrichment after sessions stays Phase 3.5: only actually asked,
generic generated follow-ups become inactive/unapproved drafts under a separate
default-off flag. Keep the reserved endpoint/worker unregistered until that
producer, redaction and rights-review contract is implemented. It does not block
3.3; storing a private generated attempt already preserves its full guidance.

## Recommended start

Start implementation with 3.3a and a small endpointing spike from 3.3b. These
establish trustworthy saved grading and confirm the voice handoff contract before
combining them. Then bank-first automatic progression, followed by generated
probes and the minimum review UI. Do not replace the proven capture path wholesale.
