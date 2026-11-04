# Voice test findings for application owners — 4 November 2026

Produced by `tools/voice-test-candidate` (branch `codex/voice-test-candidate`). These are **application**
observations backed by real-audio runs; tool defects found in the same work were fixed in the tool and are not
listed here. Evidence lives in ignored `runs/` directories (paths below); it contains fictional test speech and
redacted logs only. Nothing here was changed in application code by the tool work.

## 1. Elevate (Northwind): a learner reply reached the app but was never transcribed; the coach went silent

- Session `session_1793768850376_v90vec3ax`, run `20261104-050729-3fe782`, stack: walkthrough API :4100 /
  web :5273 / LiveKit :7880 (tenancy checkout, revision not verifiable: uncommitted changes).
- Evidence: `/Users/neelesh.ahankari/Documents/ChatGPT/VI/worktrees/spashtai-voice-workflow/tools/voice-test-candidate/runs/workflow-2026-11-04T05-07-25-789Z/`
  (`20261104-050729-3fe782/report.md`, `audio/mic-1.wav`, `audio/incoming-1.wav`, `app-elevate-turns.json`,
  `agent-run.log`).
- The candidate spoke three replies. The app's own microphone track (`audio/mic-1.wav`) carries voiced audio for
  all three (third reply ≈ 10:39:43–10:40:09 IST). Saved turns contain only the first two learner turns.
- Agent log: the second learner turn is committed (`Committed user turn: 78 words`), then at `10:40:09.811`
  `max endpointing delay updated due to pause … "reason": "new turn"` — but **no `user_transcript` event follows
  and no error is logged**. Only live-metrics ticks follow until the session closes at `10:41:39` (Leave after
  the tool's 90 s silence bound). The coach never answered the third reply.
- `deliveryAlignmentStatus` remained `pending` after 90 s (separate from the above).
- Likely area: agent STT (AWS Transcribe) stream for the third turn ended without a final transcript and without
  supervision/recovery on the Elevate path. Needs product diagnosis; not reproduced on the isolated stack today.

## 2. Interview automatic mode: recognizer stream closes and the answer stays "still being transcribed"

- Seen in 2 of 6 automatic Interview runs on 3 November (isolated stack from this checkout at 81c393b/apps).
  Evidence: `/Users/neelesh.ahankari/Applications/SpashtAI/tools/voice-test-candidate/runs/20261103-164245-36b03f/`
  and `…/runs/20261103-174156-6ef8d9/` (screenshots `05-interview-ended.png`, `report.md`).
- Agent log at the failure: `AWS_ERROR_HTTP_STREAM_HAS_COMPLETED: HTTP-stream has completed, action cannot be
  performed` shortly after the learner stopped speaking; later `interview_drain action=LEAVE
  outcome=transcript_pending reason=interim pending_interim=True`. The page shows "Your final speech is still
  being transcribed" and End practice cannot complete; the attempt stays `ASKED` with partial `capturedText`.
- Not reproduced on 4 November in 2 automatic runs plus manual runs (see §5) — intermittent.

## 3. Playback: the main play/pause button has no accessible name

- `apps/web/src/pages/SessionReplay.tsx` — the round icon `Button` with `onClick={togglePlay}` renders only a
  Play/Pause icon and has no `aria-label` (its `title` is only set when the assistant filter is active).
  Screen readers announce an unnamed button; the tool has to locate it by its icon. Suggest
  `aria-label={isPlaying ? 'Pause' : 'Play'}`.

## 4. Walkthrough bank: the default Interview selection has one reviewed question

- Preflight against the Northwind walkthrough stack: "default selection Automation Testing / 0-2: 1 reviewed
  question(s)". An automatic Interview run there ends by bank exhaustion after one answer, so it cannot exercise
  multi-question progression or Next. (The isolated clone of the dev database has 30.)

## 5. Today's passing coverage (isolated stack, apps identical to 7b57aaf/8ce6615, agent/API/web verified)

| Scenario | Outcome | Evidence (`/Users/neelesh.ahankari/Applications/SpashtAI/tools/voice-test-candidate/runs/…`) |
|---|---|---|
| manual-interview (Finish → Next, Skip → Next, Finish → End) | passed, 20/20 | `workflow-2026-11-04T06-17-03-331Z/20261104-061708-e830fa/` |
| confident-interview (automatic, 6 questions, practice time up) | passed, 18/18 | `workflow-2026-11-04T05-52-16-500Z/20261104-055609-b9b916/` |
| silence-interview (20 s silence, then 6 answers) | passed, 18/18 | `workflow-2026-11-04T06-17-03-331Z/20261104-061924-75c9ac/` |
| elevate-learner (clarity, 5 replies, processing completed) | passed, 15/15 | `workflow-2026-11-04T06-38-08-325Z/20261104-063812-b6a320/` |

## 6. Shared LiveKit collision (process, not code)

At 11:39 IST an agent worker from worktree `spashtai-candidate-5351b92` (pid 14827, `SERVER_URL=http://localhost:4110`)
registered on LiveKit `ws://localhost:7980`, which this tool's isolated stack was using; that stack's API (:4110)
also targets :7980. With two unnamed workers on one LiveKit, dispatch is random. Preflight blocked; this tool's
stack moved to :7990 and left the :7980 container and the other processes running. If that stack is yours,
keep using :7980 — it is no longer shared.

## 7. Tool defect (fixed): the candidate missed the end of a long Elevate instruction

Not an application defect. Run `20261104-063150-035fe5` (Elevate, Northwind, session
`session_1793773911299_ddqcapklx`; tool 7b57aaf from the `spashtai-voice-workflow` worktree; stack web :5283 /
API :4110 / LiveKit :7980 / agent from `spashtai-candidate-5351b92`, revision not recorded by that tool version).
Evidence preserved in place and copied for analysis.

- Capture: complete. Incoming stream started at 3.9 s; no gap fills; the coach instruction is fully present in
  `audio/incoming-1.wav` and in the recognition clip `audio/app-utterance-002.wav`.
- Segmentation: correct. Internal pauses 160–600 ms (< 900 ms end-silence) → one utterance 46.65–68.03 s
  (21.68 s clip with padding).
- Recognition: defective input length. The whole 21.68 s clip, sent to `Systran/faster-distil-whisper-small.en`,
  returns "… Here's your topic. Let's see." deterministically (3/3); its last segment is timestamped 19.0–48.0 s
  inside a 21.68 s clip. The clip's last 12 s / 5 s return "Here's your topic. Blockchain technology. Let's see
  how you do."
- Decision: correct for what was heard. At 76.23 s the candidate decided `wait` (no topic given); the coach then
  waited for the learner; the tool stopped after 90 s of silence.
- Fix `051039a`: utterances > 12 s are recognized in windows split at their quietest pause. On the real clip the
  windows are 0–6.36 / 6.36–17.30 / 17.30–21.68 s and the text includes "Blockchain technology. Let's see how you
  do." Regression `test/long-utterance.test.ts` (observed timing through the real capture path) failed before and
  passes after.

Separate and still unresolved: §1 (Northwind `session_1793768850376_v90vec3ax`, learner turn on the app microphone
track but never transcribed by the agent) — no evidence links it to this tool defect.

**For Cursor:** the `spashtai-voice-workflow` worktree is still on 7b57aaf and lacks this fix and everything in §5.
Run the tool from `codex/voice-test-candidate` (≥ 051039a), or fast-forward your branch to it (it contains 7b57aaf).

Live validation of `051039a` (isolated stack web :5173 / API :4000 on `spashtai_vtc` / LiveKit :7990 / one agent;
Personal workspace; web/API/agent verified at 051039a, apps tree identical to 81c393b). Evidence:
`tools/voice-test-candidate/runs/workflow-2026-11-04T07-03-59-282Z/` (workflow outcome passed).

| Run | Scenario | Outcome | Long coach utterances (> 12 s) windowed | Coach-word recall (evaluation only) |
|---|---|---|---|---|
| `20261104-070404-4f4a4d` | elevate-learner | passed 15/15 | 4 of 5 (17–23 s) | 94–100% |
| `20261104-070942-fab529` | elevate-learner | passed 15/15 | 4 of 5 (33–49 s) | 88–100% |
| `20261104-071742-d79779` | elevate-learner | passed 15/15 | 7 of 8 (14–25 s) | 88–100% |
| `20261104-072646-b8ef21` | confident-interview | passed 18/18 | 0 of 7 (unchanged single-window path) | — |
| `20261104-073258-7f43a8` | manual-interview | passed 20/20 | 0 of 3 | — |

Every Elevate prompt was answered; all replies were saved by the app (saved-transcript coverage passed),
recording/playback/history/analysis passed and processing completed. The original failure needs a long coach
instruction whose words fall late in the window; three reruns exercised 15 such utterances, but the Northwind
replay-context instruction from the failed run was not reproduced verbatim. The failure was deterministic for that
exact clip, which the fix demonstrably handles; other model omissions inside a ≤ 12 s window remain possible.
