# Isolated validation of `5351b92`

Production was not changed. Shared listeners `:5173`, `:4000`, `:4100`, `:5273`, `:7880`, `:4011` were left running.

## Isolated stack (verified)

| Piece | Value |
|---|---|
| Candidate worktree | `/Users/neelesh.ahankari/Documents/ChatGPT/VI/worktrees/spashtai-candidate-5351b92` |
| Candidate SHA | `5351b92d4a75341c355320cfe2548752d16809f8` |
| Web | `http://localhost:5283` (`VITE_API_BASE_URL=http://localhost:4110`) |
| API | `http://localhost:4110` (`/ready` 200) |
| Signal | `http://localhost:4021` |
| LiveKit | `ws://localhost:7980` (`vtc-livekit`, unused vs shared `:7880`) |
| Database | `spasht_voice_5351b92` on `127.0.0.1:55443` (clone of walkthrough + `DeliveryAlignmentLease` seed) |
| Callback / frontend origin | `FRONTEND_URL=http://localhost:5283`, `SERVER_URL=http://localhost:4110` |
| Voice tool | `spashtai-voice-workflow` @ `7b57aaf` (source not edited) |

Logs and evidence live under `/tmp/spasht-5351b92` (mode 700) and ignored `tools/voice-test-candidate/runs/`. Token-bearing files were restricted to their owner. Shared logs were not deleted. Tokens are not copied here.

## 1. Auth hotfix checks (Chromium)

Against isolated `5283`/`4110` @ `5351b92`, 12/12 passed:

- Signed-in organization direct entry at `/w/northwind/elevate`
- Refresh kept identity and the organization product (no sign-out)
- Workspace-token renewal after a 10-minute clock advance (`/api/workspaces/entry/northwind` ran again; identity retained)
- Personal navigation omitted `x-spasht-workspace` and kept identity
- Northwind membership suspension showed `Workspace unavailable` and did **not** clear identity; Personal still opened

Vitest coverage of the same paths remains in `apps/web` (`AuthContext`, `session`, `activeWorkspace`) and does not replace these checks.

## 2. Session-lifecycle checks

API-level isolated run (`/tmp/spasht-5351b92/session-lifecycle.json`):

- Second start without takeover: `409 VOICE_SESSION_ACTIVE`, occupancy retained (cancel path)
- Isolated LiveKit delete fault (wrong `LIVEKIT_API_SECRET` on **this** API only; shared `:7880` untouched): `503 VOICE_ROOM_RELEASE_FAILED`, occupancy retained
- After restoring `devsecret` and restarting only the isolated API: takeover `201`, old segment closed
- Late close retry: `200`, original `endedAt` kept, `audioStatus` merged to `available`
- Late recording upload: `201`; new occupancy remained until explicit end

Browser takeover dialog on isolated Elevate (`/tmp/spasht-5351b92/takeover-chromium.json`): 5/5 — confirm dialog, Cancel kept the first tab connected, Take over started the second tab, first tab lost occupancy.

Voice-test tool `7b57aaf` against this stack:

- Preflight passed (app, API, isolated LiveKit, providers, auth, northwind, Interview access, frontend/API binding).
- First Interview+Elevate pair (`workflow-2026-11-04T06-17-53-866Z`) is **invalid for product judgment**: the isolated agent had no AWS credentials, so greeting TTS failed (`AccessDeniedException`). Shared `:7880` was not faulted. Agent was restarted with the local agent env and re-registered on `:7980`.
- Interview retry `20261104-062503-b1c578` in `workflow-2026-11-04T06-24-59-676Z`: **PASSED**. Natural bank exhaustion, answers captured, recording HTTP 206, history and playback shown.
- Elevate retry `20261104-063150-035fe5` in `workflow-2026-11-04T06-31-45-802Z`: first exchange worked (coach greeting, candidate speech on an open mic, 100% content-word persist, recording 206, history). The coach’s second utterance ended mid-prompt (“Here’s your topic. Let’s see.”). The candidate waited; no further coach speech for 90 s. Required audio/persist/recording checks passed; `natural_completion` failed; `deliveryAlignmentStatus` still pending after 90 s (incomplete session). This is not the occupancy/LiveKit-release path.

## 3. Northwind Elevate stall (`session_1793768850376_v90vec3ax`)

Evidence used: ignored run `workflow-2026-11-04T05-07-25-789Z` (walkthrough `:5273` / `:4100`, not this isolated SHA). This section does not change models or prompts.

**Proven on that run**

- Browser microphone track `f867fcda-…` was `enabled`, `live`, `muted=false` at `candidate-003` play end (`timeline.jsonl`, `audio-state.json`).
- Three candidate utterances were scheduled into that mic track; turn 3 audio file exists (`audio/candidate-003.wav`, 26.2 s).
- Independent recognition of **SpashtAI** audio heard three coach utterances; the coach asked a third question and never spoke again (`conversation.json`, `report.md`).
- Agent log has exactly two end-of-utterance events (`speech_d54bee69fc8a` 10:38:15, `speech_a883833d7c3b` 10:39:11) and two `transcription_ms` values (893, 1099).
- Agent saved two user messages and three assistant messages (5 transcript turns). No third `Saved user message`.
- At 10:40:09.811 — the same second candidate-003 ended — `livekit.agents` logged `max endpointing delay updated due to pause` with `reason: "new turn"` and `pause: 7.46s`. The same event class preceded turn 2’s `received user transcript` one second later. For turn 3, no `received user transcript`, no EOU, and no persist followed. The agent session closed at 10:41:39 because the candidate left.
- `Transcribe_Streaming` appears only at plugin startup. This run’s agent log has no `AWS_ERROR` / `STREAM_HAS_COMPLETED`.

**Unverified on that run (do not infer a cause)**

- Whether LiveKit published candidate-003 frames from the browser mic track onto the agent’s subscribed user audio track.
- Whether Silero VAD observed those frames (the 10:40:09 endpointing line is consistent with a pause after speech, but the log does not name the track or dump VAD frames).
- Whether the recognizer was started for turn 3, received audio, or produced a dropped/empty result. There is no per-turn Transcribe start/result line after startup.
- Why endpointing’s `new turn` did not continue into `received user transcript` / EOU / persist.

Do not treat historical Transcribe stream errors as this run’s cause.

## 4. Delivery alignment (separate from the stall)

Walkthrough DB had no `DeliveryAlignmentLease` row `id='automatic'`. `sweepDeliveryAlignment` returns immediately when `updateMany` count is 0, so every Elevate job stayed `pending` with `attempts=0`.

On the isolated clone, seeding that lease unblocked the worker: one cloned job completed, two entered `retry`, others correctly waited for recording/transcript. The follow-up fix upserts the lease before claiming so a missing seed cannot stall the backlog again.

## 5. Credential containment

- Production logs were not deleted. Previously identified workspace JWTs were expired; expiration does not prove they were unused while valid.
- Local token-bearing files (walkthrough/isolated API logs, VTC `.auth`, `.env.local`, login response scraps) were mode `600`/`700` and left in place as private evidence.
- This document does not copy tokens.

## 6. Release recommendations

### Minimal redaction/auth hotfix

Ship together, after API restart, still **do not merge/deploy from this note until an owner decides**:

- `587591a` Redact workspace credentials in serialized request logs
- `d0c1f06` Keep identity on organization refresh without a workspace token

Completed checks: request-logger unit tests (earlier); Chromium direct entry, refresh, renewal, suspension, Personal navigation on isolated `5351b92` (this SHA already contains both commits). Organization product requests remain fail-closed.

### Session-lifecycle fixes

- `5351b92` Decide takeover and close from server time, and keep occupancy if LiveKit release fails

Completed on isolated `5351b92`: cancel retains occupancy; isolated LiveKit delete fault returns `503 VOICE_ROOM_RELEASE_FAILED` and retains occupancy; recovery takeover closes the old segment; late close/upload keep the original close and accept the recording.

Remaining blockers before shipping `5351b92`:

- Elevate did not complete a multi-turn exercise on this SHA: after a successful first exchange the coach’s second prompt truncated and no further coach audio arrived. Recording and first-turn persist succeeded. Do not treat this as a LiveKit-release failure; do not treat the Northwind third-turn gap as fixed.
- Northwind third-turn recognition gap is still not localized to publication vs VAD vs recognizer vs persist.
- Delivery-alignment lease upsert is a separate follow-up commit; walkthrough/prod DBs that lack the seed will keep `attempts=0` until that ships or the row is inserted. Incomplete Elevate sessions also remain `pending` after 90 s.
