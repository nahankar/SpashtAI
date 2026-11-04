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
| manual-interview (Finish → Next, Skip → Next, Finish → End) | passed | see tool README validation record |
| confident-interview (automatic, 6 questions, practice time up) | passed | see tool README validation record |
| elevate-learner (clarity) | see tool README validation record | |
