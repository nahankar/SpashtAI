# Phase 3.3b — Conversation coordinator (reviewed plan)

Plan date 25 October 2026, branch `codex/interviews-phase3.3b-coordinator` (from the 3.3a acceptance
branch). It replaces the 3.3b section of [INTERVIEWS-PHASE-3.3.md](./INTERVIEWS-PHASE-3.3.md) where they
differ, and was reconciled with the code, the [3.3a contract](./INTERVIEWS-PHASE-3.3a-IMPLEMENTATION.md) and
the fact-checked [3.3a acceptance report](./INTERVIEWS-PHASE-3.3a-ACCEPTANCE.md).

## Outcome

In a practice started with the new capability, the interviewer reads a saved bank question, listens, waits
through thinking pauses, saves the provider-final answer and asks the next eligible bank question without a
click. Finish answer, Skip question and Next question remain visible fallbacks. Progression never depends
on a technical evaluation, and no grade is spoken or invented. Existing manual runs stay manual.

## Out of scope (stays later)

- Grade-dependent adaptation, difficulty changes and generated follow-ups (3.3c).
- Spoken technical feedback from assessments (needs a measured live-feedback budget; 3.3c/3.3d).
- Spoken intent recognition ("repeat", "skip", "pause" said aloud). 3.3b offers these as buttons only.
- Teaching and Ask this session (3.4). Progress Pulse remains untouched by interviews.

## Findings that shape the design

| Finding (code) | Consequence |
| --- | --- |
| `drain()` calls `commit_user_turn(transcript_timeout=8.0)`. LiveKit waits for a *new* provider final unless one arrived < 0.5 s earlier, so almost every Finish, Skip, Pause and End waits the full 8 s (pilot: 8.36–8.44 s). After one commit, LiveKit drops later finals for that turn, so every retry also waits 8 s. | Replace the commit wait with our own barrier over the raw provider events already observed in `stt_node`. Do not call `commit_user_turn` for saving. |
| `pending_audio`/`pending_interim` alone are not safe: VAD stays "speaking" through pauses under 0.8 s, and detaching audio emits a self-caused `listening` event with `created_at = now`. | The barrier needs a silence-settle window after detaching, plus the live VAD state, plus "no interim newer than the last final". |
| A FINISH receipt followed by a segment close (reload, disconnect) before `/finish` binds the drain fence to the still-ASKED attempt, and `finishAnswer` then returns 409 for that attempt for good. | Server fix: a complete FINISH receipt for the attempt on that segment satisfies the fence. Coordinator resumes an unfinished receipt after reconnect. |
| No internal route can finish or advance; `/next` has no precondition, so a stale tab or late handler can create an extra attempt. | Agent-owned internal finish/next for conversation runs; `/next` accepts an optional `afterAttemptId` precondition for both paths. |
| `interview_adaptive` already means learner evaluation; `InterviewRun` rows are immutable by trigger. | New default-off `interview_conversation` flag and a new insert-only `InterviewRun.conversationPolicySnapshot` (NULL = manual). |
| `say(allow_interruptions=False)` never waits for silence; `activate_question` holds the capture lock through playout, so Pause waits for the whole question. | The coordinator speaks only after a confirmed save (learner silent ≥ the handoff window, mic muted), and Pause/End interrupt the question handle. |
| `lk.control` messages are one-off and can be missed; participant attributes persist across reconnects. | Publish coordinator state as agent participant attributes; keep data messages only as hints. |
| Findings latency adds a 0–2 s worker pickup (2 s interval, one job per tick) and a 0–3 s UI poll. | Wake the learner worker after the finish transaction commits; poll faster while a job is pending. |
| A reload loses the in-progress browser recording (chunks live only in memory; FINISH/NEXT never seal it). | Tracked as defect D-1 below, with a fix design; not fixed in 3.3b. |

## Design

### Capability and run mode (server)

- Flag `interview_conversation`: label "Interview conversation · learner pilot", `SELECTED_USERS`, hidden and
  disabled by default (migration row + `featureFlags.ts` + Admin `PILOT_FEATURES` + the Admin flag page).
  It is **not** in `LEARNER_FEATURES`, so toggling it never cancels evaluation jobs.
- `startPractice` pins `conversationPolicySnapshot = { version: 'conversation-1', handoffSilenceMs, settleMs,
  maxBarrierMs }` only when the owner has Interviews, Interview voice and Interview conversation access.
  Existing and capture-only runs keep NULL and behave exactly as today.
- `voiceState` adds `conversation: { enabled, policy }` (enabled = pinned and current access, so revoking the
  flag falls back to manual for the rest of the run), `attemptHasSpeech` (chunks saved for the attempt in any
  segment) and `unfinishedReceipt` (a FINISH/SKIP receipt whose attempt is not yet completed).
- Practice options expose `conversationAvailable`; run detail exposes `conversationMode`.

### Save barrier (agent, all modes)

`InterviewCapture.drain` keeps the same lock, request deduplication and receipt contract, but replaces the
`commit_user_turn` wait:

1. Detach input (unchanged). The STT keepalive keeps feeding silence, so Transcribe finalises naturally.
2. Wait until **all** hold for `settleMs` (initial 1.2 s): no interim newer than the last final, VAD not
   speaking, no speech start since the last final. Any interim or speech restarts the settle clock.
3. Bound the wait by `maxBarrierMs` (8 s). On expiry return `TRANSCRIPT_PENDING` with a content-free reason
   (`interim`, `speech`), as today.
4. Flush the chunk queue, save the receipt and return.

Retries no longer pay a fixed 8 s. Timing logs are content-free (stage name, milliseconds, flags).

### Coordinator (agent, conversation runs only)

New `apps/agent/interview_coordinator.py`, owning one async lock shared with manual controls:

| State | Meaning | Learner mic |
| --- | --- | --- |
| `asking` | Interviewer is speaking the saved question | off |
| `listening` | Waiting for or hearing the answer | on |
| `candidate_end` | Silence after a provider final; handoff countdown running | on |
| `confirming` | Save barrier waiting for provider-final speech | off |
| `saving` | Receipt and server finish | off |
| `preparing` | Server selecting the next eligible bank question | off |
| `paused` / `ended` | Learner paused or practice ended | off |
| `waiting` | Manual fallback needed (time up, bank exhausted, error) | per state |

- **Patient handoff.** A countdown starts when VAD reports a real end of speech (not one caused by our own
  detach) and at least one provider final exists for the attempt (or `attemptHasSpeech` after a resume). It
  uses `handoffSilenceMs` (initial 5.0 s, so 2–4 s thinking pauses never hand off). Any VAD speech or interim
  cancels it; each new final re-arms it. No minimum word count. Silence without any final never hands off.
- **More time.** A learner control suspends automatic handoff for the current answer; Finish still works.
- **One path for Finish.** In conversation runs the browser's Finish, Skip and Next send an RPC; the
  coordinator runs drain → internal finish → internal next → ask under the same lock and request identity as
  automatic handoff. Duplicate or late requests return the recorded outcome.
- **Never talking over the learner.** The next question is spoken only after a confirmed save; the mic is
  muted from the start of confirming until the question has been read.
- **Interrupted playback.** Pause, End and disconnect interrupt the speaking handle. An attempt is marked asked
  only after the question finishes playing, so an interrupted question is re-read on resume.
- **Repeat question.** Re-speaks the saved question for the open attempt without creating an attempt.
- **Reconnect and refresh.** A new agent reads `voiceState`: an unfinished receipt is completed first; an open
  attempt resumes (the question is re-read only if it was not fully asked); a consumed advance cannot repeat
  because internal next requires `afterAttemptId`.
- **Time and bank limits.** Practice time expiry stops new questions but keeps the current answer savable;
  `PRACTICE_DURATION_REACHED`, `PRACTICE_QUESTION_LIMIT` and `QUESTION_BANK_EXHAUSTED` move to `waiting` with a
  short spoken closing line and the existing End control.
- **Evaluation independence.** The coordinator never reads assessments. Evaluation failure, quota or a
  disabled evaluator leave progression unchanged; findings remain in the report.

### Internal routes (server)

- `POST /internal/interviews/attempts/:id/finish { receiptId, skip }` → `finishAnswer` as the run owner, only
  for conversation-enabled runs; records the same `answer_completed`/`answer_skipped` usage events.
- `POST /internal/interviews/runs/:id/next { afterAttemptId }` → `prepareBankAttempt` with the precondition;
  returns the existing open attempt when the advance already happened.
- Learner `POST /runs/:id/next` accepts the same optional `afterAttemptId`.
- After any finish commits, wake the learner evaluation worker (single-flight with a rerun flag).

### Browser

- `InterviewControls` reads coordinator state from the agent's participant attributes in conversation runs and
  shows the states above in an `aria-live="polite"` region; manual runs are unchanged.
- Visible controls: Finish answer, Skip question, More time, Repeat question, Pause, End practice, Discard;
  Next question appears only in `waiting`.
- Findings poll every 1 s while an evaluation is pending (3 s otherwise) and no longer clear rows on refresh.

## Dependencies

LiveKit agents 1.5.8 (`stt_node`, `user_state_changed`, `set_attributes`, speech handles); the existing
InterviewCapture receipt contract and drain-fence triggers; Transcribe partial stabilisation; the learner
worker; Playwright with the local fake-microphone driver for real-path checks.

## Defects tracked

- **D-1 Refresh loses the in-progress recording** (open). Reproduction: reload during a practice; playback shows
  "One recording segment has no audio". Cause: MediaRecorder chunks are held in memory and uploaded only when
  the recorder stops. With automatic progression one segment can span several answers. Fix design (later):
  IndexedDB chunk journal with recovery upload to the old segment, purge on upload/discard/sign-out, a
  multi-tab claim, and consent wording review. Saved answers and transcripts are not affected.
- **D-2 FINISH receipt then segment close blocks Finish** (fixed in 3.3b, see above).

## Acceptance checks

Coordinator behaviour is tested first with controlled outcomes (fake clock, fake STT/VAD events, stubbed server
and stubbed evaluator results) before using model budget:

| Area | Checks |
| --- | --- |
| Thinking pauses | 2 s, 3 s and 4 s pauses never hand off; ≥ 5 s silence after a final hands off once |
| Renewed speech | Speech or an interim during the countdown cancels it; the answer keeps every final |
| Late finals | A final arriving during confirming is saved before the receipt; an interim that never finalises returns `TRANSCRIPT_PENDING` without data loss |
| Double actions | Automatic and manual Finish, or two manual clicks, produce one receipt, one snapshot and one advance |
| Skip | No snapshot, no grade, one advance |
| Time expiry | Current answer savable; no new question; `waiting` with End |
| Evaluation failure | Failed, cancelled or budget-exhausted evaluation never blocks or alters progression |
| Pause/resume | Pause during listening and during asking; resume re-reads only an unasked question |
| Reconnect | Unfinished receipt completed; no duplicate attempt; manual runs unchanged |
| Discard | Fences all later writes; coordinator stops |
| Access revocation | Conversation flag revoked: manual fallback; Interviews or voice revoked: only End |
| States | Each state maps to accurate UI text; mic state matches |
| Manual runs | Existing manual behaviour and tests unchanged |

Real-path checks (local stack, synthesized speech; human run later): consecutive questions without clicks,
thinking pauses, one save per answer, Finish/Skip fallbacks, Pause/Resume, reload, and per-stage latency.

**Latency budget** (to measure, not a guarantee): Finish → saved ≤ 2.5 s p95 (barrier settle plus server);
automatic handoff ≈ handoff window + save; Finish → findings ≈ save + model call (2.4–2.8 s p50–p95) + ≤ 1 s
UI poll; next question audible ≤ 2 s after save.

Human microphone testing and expert review of grades remain acceptance requirements for 3.3a and 3.3b.
