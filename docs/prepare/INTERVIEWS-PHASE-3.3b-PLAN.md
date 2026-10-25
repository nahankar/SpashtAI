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
`commit_user_turn` wait. Quiet is never treated as completion (revised after review, edccbcd):

1. **Boundary.** The browser mutes the microphone and the agent detaches room audio from the recognizer. Audio
   sent before the boundary keeps being recognised (the STT keepalive feeds silence so Transcribe finalises),
   and its provider finals are still accepted until the barrier confirms.
2. **Pending speech.** Two flags keep a save pending: an interim with words that no provider final has covered,
   and voiced audio (VAD speech start) with no provider final after it. Voice still reported at the request
   counts only when no transcript arrived since it started or the last final is older than VAD's 0.8 s tail
   (within the tail it is VAD's own trailing silence). A provider final, even an empty one, clears both; only a
   final with words becomes answer text.
3. **Settle.** The save proceeds when nothing is pending and `settleMs` (1.2 s) of quiet has passed since both
   the boundary and the last speech or transcript event. Any interim or speech restarts the window.
4. **Bound.** After `maxBarrierMs` (8 s) the drain returns the recoverable `TRANSCRIPT_PENDING` with a
   content-free reason (`interim`, `speech`), keeps the attempt open and saves nothing. Unresolved speech is
   never discarded automatically: the learner retries, or explicitly chooses **Save confirmed speech only**
   (`acceptUnresolved`, FINISH only), which waits up to 2.4 s more and then saves the confirmed finals.
5. **Skip.** Stops accepting at once with no wait; skipped speech is never saved. Before the next answer accepts
   speech, `activate_question` resets the user turn (restarting the recognizer stream), so late results for
   skipped or finished audio cannot attach to the next question.
6. Flush the chunk queue, save the receipt for exactly the flushed turns and return. A completed request id
   returns the recorded receipt; the same id with another action is `REQUEST_CONFLICT`.

Retries no longer pay a fixed 8 s. Timing logs are content-free (`interview_drain`: barrier, flush, receipt
and total milliseconds plus the two flags; `interview_coordinator`: handoff and drain/finish/next times).

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
- **Interrupted playback.** Pause and End interrupt the speaking handle (or skip a question about to start).
  The attempt is still marked asked, because Pause/End receipts require an asked attempt, but input never
  opens and no `listening` state is published; the question is re-read on resume.
- **Repeat question.** Re-speaks the saved question for the open attempt without creating an attempt.
- **Reconnect and refresh.** A new agent reads `voiceState`: an unfinished receipt is completed first (only
  the newest one, and only if no speech was saved after it); after a completed answer it moves to the next
  question; an open attempt is announced as `asking` and re-read. A consumed advance cannot repeat because
  internal next requires `afterAttemptId`.
- **Recovery.** Any failed stage (save, finish, next, reading the question) publishes `waiting` with a reason;
  **Continue** resumes exactly that step and never drains a saved answer twice. A Finish with nothing said
  returns `NO_SPEECH` and keeps the answer open (no empty receipt). Pause or End waits for an in-flight save
  and never creates an unheard next question.
- **Access withdrawn.** Internal finish/next return `CONVERSATION_UNAVAILABLE`: the coordinator turns off,
  publishes the saved receipt, and the browser finishes it through the learner route; run detail reports
  conversation only while access remains, so browser and agent fall back to manual together.
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
| Late finals | A final arriving during confirming is saved before the receipt; an interim that never finalises returns `TRANSCRIPT_PENDING` without data loss; saving only confirmed speech is the learner's explicit choice |
| Completeness | Short and long answers, Finish right after the last word, Finish while speaking, delayed finals and reconnects keep every word spoken before the boundary; no word reaches another question |
| Double actions | Automatic and manual Finish, or two manual clicks, produce one receipt, one snapshot and one advance |
| Skip | Immediate; no snapshot, no grade, one advance; late results for skipped speech never reach the next answer |
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

## Local real-path pilot results (25 Oct 2026, after review fixes)

Local stack (web, API, LiveKit, agent with Transcribe/Polly, learner worker); synthesized Polly speech through
an injected browser microphone. Not a human test. Each scenario ran once, so these are indicative, not p95.

| Measure | Before 3.3b | Manual run | Conversation run |
| --- | --- | --- | --- |
| Finish → saved (UI) | 8.36–8.44 s | 1.84–1.87 s | receipt 1.55 s after click |
| Finish while speaking → saved | — | 2.85 s | 2.36 s |
| Agent barrier (settle + grace) | ~8 s | 1.46–2.28 s | 1.46–2.28 s |
| Skip → done | ~8 s | 0.13 s | 0.08 s |
| Last word → saved, automatic | — | — | 7.35–7.47 s (0.8 s VAD + 5 s silence + 1.45 s barrier) |
| Last word → next question starts | — | — | 7.5 s; question audio then 6–8 s |
| Saved → evaluation completed | 2.7–5.9 s | (evaluation off) | 2.4–3.0 s, plus ≤ 1 s page poll |
| Reload → listening again | — | — | 8.2 s (includes re-reading the question) |
| End right after an automatic save | — | — | ends in 0.5 s (before the fix the run stayed open) |

Completeness: every answer kept its last words (3/3 tail words) except Finish-while-speaking, where only words
after the click are absent by design; 3 s thinking pauses never split an answer; More time held through a
6.5 s pause; no skipped speech reached the next answer; one receipt, one snapshot and one evaluation per saved
answer; Progress Pulse untouched. Remaining acceptance requirements: a human microphone run and an expert
spot-check of grades.
