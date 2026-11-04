# SpashtAI voice test candidate

A developer-only command-line tool that behaves like a human learner: it opens SpashtAI in a real Chromium
browser, **listens to SpashtAI's actual spoken audio**, recognizes it, decides what to say, and **speaks back
through the browser microphone stream**. It runs a complete Interview or Elevate session through the normal UI,
then verifies the history entry, recording, transcript and evaluation and writes an evidence bundle.

It lives in this repository so it evolves with the product, but it is a separate package: it is not an npm
workspace, it is not imported by `apps/*`, and nothing here is built or deployed with the application.

## How it works

```
 SpashtAI agent ──WebRTC──▶ test browser ──remote audio tap──▶ VAD ─▶ speech recognition ─▶ candidate brain
       ▲                       (real app UI)                                                    │ reply text
       │                                                                                         ▼
       └──WebRTC◀── app mic track (LiveKit + SessionRecorder) ◀── virtual microphone ◀── speech synthesis
```

- **Virtual microphone** (`src/browser/inject.ts`): inside the test browser only, `getUserMedia({audio})` returns
  a WebAudio `MediaStreamDestination` track. Synthesized utterances are scheduled into it when the candidate
  speaks; otherwise it carries silence. The app keeps full control of the track (it enables it only while the
  interviewer is listening) and publishes/records it exactly as it would a hardware microphone.
- **Listening**: every remote audio track received by the page's `RTCPeerConnection`s is tapped and streamed to
  Node as PCM. An energy VAD finds SpashtAI's utterances; each one is transcribed independently. DOM
  transcripts and agent state are **never** used to decide what to say (the page text is saved only as
  secondary diagnostics).
- **Recognition windows** (`src/audio/recognition.ts`): an utterance longer than 12 s is recognized in windows
  split at its quietest pause (never mid-word); shorter utterances are sent whole. The local Whisper model
  deterministically dropped the end of a 21.7 s coach instruction (run `20261104-063150-035fe5`), while ≤ 12 s
  windows of the same audio returned every word. Each request is logged as `recognition_request` with its window
  bounds and text.
- **Turn taking** (`src/engine/conversation.ts`): the candidate replies once SpashtAI has been quiet for
  1.4 s after an utterance, after a natural think delay, and only when the app's microphone track is enabled.
  New SpashtAI speech cancels a reply in preparation (the heard text is merged into the next turn), duplicate
  utterances are ignored, and the candidate stops talking if SpashtAI talks over it for 1.2 s. The candidate
  cannot hear itself: its audio is never on the captured incoming tracks.
- **Adapters** (`src/adapters/`): navigation, setup, completion detection, ending and verification differ per
  experience; the audio/conversation engine is shared.

## Prerequisites

1. A running SpashtAI stack (web, API, LiveKit, agent). Default target: `http://localhost:5173`.
2. Provider endpoints (OpenAI-compatible; defaults are the local containers SpashtAI's pipeline already uses):
   - speech recognition: speaches/faster-whisper on `:8001` (`apps/agent/start-local-stack.sh start`)
   - speech synthesis: Kokoro on `:8002` (same script)
   - response generation: Ollama on `:11434` with the configured model (default `gemma4:12b`)
   Any OpenAI-compatible service works via `VTC_*` variables (see `config.example.env`).
3. Node 20+.

```bash
cd tools/voice-test-candidate
npm install
npx playwright install chromium
cp config.example.env .env.local      # git-ignored; fill in the test account
npm run vtc -- providers              # reachability only, no paid calls
npm run vtc -- diagnose               # provider-free audio transport check
```

### Test account and browser session

- Local stack, password account: `npm run vtc -- register-local` (creates the fictional `VTC_EMAIL` account
  via the local register API — refused for non-local targets), then `npm run vtc -- login` (signs in through
  the app's email/password form at `/auth/admin` and saves `.auth/<host>_<port>.json`, mode 600).
- Google-only accounts or remote stacks: `npm run vtc -- login --manual --target <url>` opens a visible
  browser; sign in yourself and the session is saved.

- **Manual Interview account.** The Interview mode is decided per run by the account's `interview_conversation`
  access. `manual-interview` needs a second fictional account *without* that access:
  `npm run vtc -- register-local --account manual` then `npm run vtc -- login --account manual`
  (credentials `VTC_MANUAL_EMAIL` / `VTC_MANUAL_PASSWORD`, session `.auth/manual-<host>_<port>.json`).
  Automatic scenarios need an account *with* it. Preflight blocks when an account is in the wrong mode.
  Granting/removing that access is a one-time setup on a dedicated test database (see isolated stack); the tool
  never changes flags or grants itself.

`.auth/`, `.env.local` and `runs/` are git-ignored; evidence files are written owner-only (0600/0700).

## Running

```bash
# Interview happy path (5-minute practice, ends when the app says practice time is up)
npm run vtc -- run --scenario confident-interview --interview-minutes 5

# Elevate learner following the Clarity exercise
npm run vtc -- run --scenario elevate-learner --elevate-focus clarity

# Other scenarios
npm run vtc -- run --scenario hesitant-interview      # fillers + real pauses in the audio
npm run vtc -- run --scenario silence-interview       # stays silent 20 s after the first question
npm run vtc -- scenarios                              # list scenarios and fictional profiles
npm run vtc -- --help                                 # every option
```

Useful options: `--headed` (watch it; speaker output stays muted unless `--speakers`), `--max-minutes`,
`--max-turns`, `--close-unfinished` (end a leftover Interview through the UI first), `--verify-timeout`,
`--llm-provider scripted` (no LLM; canned profile answers), `--tts-provider macos-say`, `--video`, `--no-trace`,
`--trace-full` (adds screencast and DOM snapshots to the trace — tens of MB per minute because the live audio
meter redraws constantly), `--browser-channel chrome`.

**Production**: any `spasht.ai` host is treated as production and refused unless `--allow-production` is given
(override lists: `VTC_PRODUCTION_HOSTS`, `VTC_NONPRODUCTION_HOSTS`).

Exit codes: `0` passed, `1` failed, `2` blocked (missing prerequisite), `3` inconclusive, `64` usage error.

### Running an isolated local stack

LiveKit dispatches rooms to *any* registered unnamed agent worker, so two checkouts sharing one LiveKit server
get each other's sessions. The ports below are examples: another session may already be using them (preflight
reports every agent worker on the LiveKit and blocks if there is more than one). Pick unused ports — e.g. copy
`infra/livekit.isolated.yaml` with the three ports changed — and never stop another session's worker or
container; move your own stack instead. To test this checkout without disturbing a stack already running elsewhere, give it
its own LiveKit and ports (no shared services are stopped or restarted):

```bash
docker run -d --name vtc-livekit -p 7980:7980 -p 7981:7981 -p 7982:7982/udp \
  -v "$PWD/infra/livekit.isolated.yaml:/etc/livekit.yaml" livekit/livekit-server:latest --config /etc/livekit.yaml
cd ../../apps/agent && SIGNAL_API_PORT=4011 .venv312/bin/python -m analytics.signal_api            # terminal 1
cd ../../apps/agent && LIVEKIT_URL=ws://localhost:7980 SERVER_URL=http://localhost:4000 \
  SIGNAL_API_INPROCESS=0 SIGNAL_API_URL=http://localhost:4011 .venv312/bin/python main.py dev      # terminal 2
cd ../../apps/server && LIVEKIT_URL=ws://localhost:7980 SIGNAL_API_URL=http://localhost:4011 npx tsx src/index.ts  # terminal 3
cd ../../apps/web && npx vite --port 5173 --strictPort                                            # terminal 4
```

The server still uses `apps/server/.env` for everything else (AWS voice pipeline, JWT). To use a **dedicated test
database**, clone the local dev database once and point only this API at it (nothing shared is changed):

```bash
# once, while nothing is connected to the source database; then run the API with
# DATABASE_URL pointing at spashtai_vtc instead of spashtai
docker exec -i spashtai-postgres psql "<admin connection to postgres>" -c 'CREATE DATABASE spashtai_vtc TEMPLATE spashtai'
```

On that clone only, make automatic conversation per-account (audience `SELECTED_USERS` for
`interview_conversation`) and grant it to the automatic test account, so the manual account runs manual mode.
A cloned database still references the checkout's local `apps/server/audio_storage`; its workers read those
files, and nothing is deleted unless sessions are pending deletion (check before reusing).

## Scenarios

| Scenario | Experience | Behaviour |
|---|---|---|
| `confident-interview` | Interview (automatic) | Direct answers with one concrete example (40–75 words); the interviewer finishes answers and moves on. |
| `manual-interview` | Interview (manual) | Answers Q1 → **Finish answer** → **Next question**; says it will skip Q2 → **Skip question** → **Next question**; answers Q3 → **Finish answer** → **End practice**. Verifies saved statuses ANSWERED/SKIPPED/ANSWERED, the run's saved mode, per-reply saved answers, feedback, recording and playback. Needs ≥ 3 reviewed questions in the default selection. |
| `hesitant-interview` | Interview | Fillers ("um", "uh") written into the reply text, and 0.9–1.8 s of real silence inserted at hesitation markers. Inserted and measured pauses are reported per turn. Pauses stay below the ~5 s automatic-finish silence. |
| `silence-interview` | Interview | Stays silent for 20 s after the first question, records whether SpashtAI spoke during the silence, then answers. |
| `elevate-learner` | Elevate | Follows the coach's instructions turn by turn; ends with **Leave** when the coach's audio says the exercise is over. |

Profiles (`src/candidate/profiles.ts`) are fictional. Accents and background noise are **not** implemented.
Interruptions are not scripted; the only overlap behaviour is yielding when SpashtAI talks over the candidate.

## Results and evidence

Each run writes `runs/<run-id>/`:

| File | Content |
|---|---|
| `report.md` / `report.json` | Result (passed / failed / blocked / inconclusive) with reasons, checks, conversation, timings, provider request counts, missing evidence, coverage limits |
| `timeline.jsonl` | Every browser action, audio boundary, candidate decision and verification step on one epoch clock |
| `manifest.json` | Target, experience, scenario, profile, tool version/commit, providers, limits, candidate system prompt |
| `audio/incoming-N.wav` | SpashtAI audio as received by the browser (16 kHz mono) |
| `audio/mic-N.wav` | The app's own microphone track as captured — candidate speech, silence while the app disabled it |
| `audio/conversation-stereo-L_spashtai-R_candidate-mic.wav` | Both aligned to the run start: left = SpashtAI, right = candidate |
| `audio/candidate-NNN.wav`, `audio/app-utterance-NNN.wav` | Each candidate reply as synthesized; each SpashtAI utterance as sent to recognition |
| `conversation.json` | Turns, independent transcript, the candidate's own conversation history |
| `app-*.json` | Read-only API snapshots used for verification (run, assessments, turns, metrics) |
| `screenshots/` | Setup, connected, before end, ended, history, playback; `99-failure.png` on errors |
| `browser/trace.zip` | Playwright trace (actions + network; `--trace-full` adds screencast/DOM), tokens redacted (`npx playwright show-trace browser/trace.zip`) |
| `browser/page-text-at-stop.txt` | Visible page text when the conversation stopped (secondary diagnostics) |
| `errors.json` | Sanitized console errors, page errors, failed requests, HTTP 5xx |

**Outcome rules**: *passed* only when the application itself ended the session (e.g. "Practice time is up") —
or, for `manual-interview`, the scripted learner plan completed and the learner pressed End practice — the
session was ended through the UI, and every required check passed. Every non-pass reason is prefixed with what
it points at: **[application]** (e.g. the reply is on the app microphone track but missing from the saved
transcript), **[tool]**, **[setup]** (accounts, stack targeting, origin binding) or **[unknown]**. A run stopped by `--max-turns` or
`--max-minutes` is *inconclusive*, never passed. Results that do not appear within `--verify-timeout`
(recording, evaluation) are *pending* → *inconclusive*. Checks are labelled by basis: **browser** (displayed),
**audio** (measured), **api** (read-only API with the test session — diagnostic, not user-visible) or **tool**.
Evaluation checks confirm that results exist; scores are never judged. Answer relevance is advisory.

**Coverage areas** (column in the checks table, kept distinct): **live-audio** — audio exchanged during the
session as captured in the test browser, including how much of each reply was actually carried by the app's own
microphone track; **saved-recording** — the stored recording after the session: availability (range request),
browser playback advancing via the page's own control, and decoded content containing the candidate's speech;
**app-data** — saved answers/transcript per reply (potentially missing turns are named), feedback, analysis
(*pending* vs *completed* vs *failed*), history; **mode** — automatic vs manual Interview actually exercised.
Physical speaker output is never covered.

**Application under test**: each report lists web/API/agent with endpoint, process, source directory, commit
and a status — **verified** (clean source directory at HEAD and the process started after HEAD moved, or HEAD
moved but that directory's tree is identical to the one at process start), **unverified** (running code may
differ) or **unknown** (remote/containerized). The test tool's own revision is shown separately and is never the
application revision. `--app-source` records a declared checkout for stacks that cannot be inspected.

**State at stop**: last SpashtAI speech received, last recognized words, last candidate speech on the app
microphone track, the last reply, and the app microphone state when the conversation stopped.

**Timings**: SpashtAI speech boundaries come from the VAD on received audio (20 ms frames; end = last voiced
frame followed by ≥ 0.9 s of silence). Candidate boundaries are virtual-microphone playback start/end. Reported
per turn: SpashtAI speech end → candidate audio start, and candidate audio end → next SpashtAI speech start.

**Secrets**: tokens, cookies, passwords and signed URLs are redacted from the timeline, reports, errors and the
trace archive. Login is never traced. Provider requests have per-run limits and timeouts; a timed-out request
is not retried (it may have been billed), transient HTTP errors are retried once, and a session is never
restarted automatically.

## Coverage limits

- Physical microphones, device selection, OS permission prompts, hardware echo cancellation and room acoustics
  are not exercised: the microphone is substituted inside the test browser (Chromium also runs with fake-media
  flags so no permission prompt appears).
- SpashtAI audio is captured from the received WebRTC track, before the page's audio element; speaker output
  and autoplay are only covered by clicking the app's audio activation button when it is shown.
- Answer quality and coaching quality are not judged. Elevate completion is the candidate's reading of the
  coach's audio (as for a human); Elevate has no in-UI completion signal.
- The browser video has no audio track.

## Development

```bash
npm test           # unit tests: audio utilities, VAD, conversation orchestration, redaction, outcome rules
npm run typecheck
npm run vtc -- diagnose
```

## Validation record (2026-11-03, isolated local stack from this checkout)

| Layer | Result |
|---|---|
| Unit tests (40) | pass — VAD boundaries, gap alignment, turn merging, cancellation/re-queue, duplicate suppression, mic gating, yielding, controlled silence, timeouts, redaction, production guard, outcome rules, provider retry/budget/cancellation |
| `diagnose` (provider-free) | pass — 3/3 fixture utterances through virtual mic → WebRTC → tap, 46 ms latency, gap-free chunking, disabled track carries silence |
| Interview, `confident-interview`, 5 min | **passed** — 6 answers, ended by "Practice time is up", app transcript 95% word recall, recording, 6 assessments, history, playback |
| Elevate, `elevate-learner`, clarity | **passed** — 10 learner turns, coach wrap-up heard, Leave → results, transcript 99% recall, recording, metrics, async processing settled, history |
| Interview, `hesitant-interview` | **passed** — fillers in text, ~1 s inserted pauses measured as 1.4–1.5 s in the audio |
| Interview, `silence-interview` | **failed (product finding)** — 20 s silence handled (no re-prompt, question kept open), first answer saved; the second answer then stayed "still being transcribed" after an agent-side AWS Transcribe stream error, so the practice could not end |

The same agent-side recognizer stall (`AWS_ERROR_HTTP_STREAM_HAS_COMPLETED`, answer stuck as transcript pending,
End practice not completing) occurred in 2 of 6 live Interview runs. Response gaps (SpashtAI speech end →
candidate audio) were ~7–8 s median with local CPU providers; the first turn of a run can be ~30 s while Ollama
loads the model.

## Validation record (2026-11-04)

Isolated stack from this checkout (apps tree identical to 81c393b; web/API/agent provenance verified), cloned
database `spashtai_vtc`, own LiveKit and agent. All four scenarios passed after tool fixes; see
`docs/VOICE-TEST-WORKFLOW-VALIDATION.md` for paths and `docs/VOICE-TEST-FINDINGS-2026-11-04.md` for application
findings. Median SpashtAI-end → candidate-start gap ≈ 8–10 s with local CPU providers.

| Scenario | Outcome |
|---|---|
| manual-interview | passed 20/20 (Finish/Next/Skip/End through the UI, manual mode saved) |
| confident-interview | passed 18/18 (automatic, 6 questions, practice time up) |
| silence-interview | passed 18/18 |
| elevate-learner | passed 15/15 (all 5 replies saved, processing completed) |

## Standard agent workflow

Root `AGENTS.md` and `.cursor/rules/automated-voice-validation.mdc` require this workflow for Elevate/Interview
voice changes. Do not hand routine spoken tests to the owner. Ask only for an unresolvable prerequisite,
physical device coverage or subjective judgment, explaining the exact need.

The root shortcuts invoke this separate tool package (it remains excluded from app builds/deployments):

```bash
# Once per tool checkout; preserve existing ignored configuration and private sessions.
npm --prefix tools/voice-test-candidate ci
cd tools/voice-test-candidate
npx playwright install chromium
# Create .env.local from config.example.env ONLY if it does not already exist; set a fictional account.
# Password login saves private state; Google login may require a one-time interactive --manual login.
npm run vtc -- login --target http://localhost:5273
cd ../..

# Check prerequisites without starting a practice or stopping/restarting any service.
npm run voice:preflight -- \
  --target http://localhost:5273 --api-url http://localhost:4100 \
  --livekit-url ws://localhost:7880 --workspace northwind \
  --api-log /private/tmp/spasht-walkthrough/api.log \
  --agent-log /private/tmp/spasht-walkthrough/agent-logs/agent.log

# Same options; real audio in both directions, one Interview followed by one Elevate.
npm run voice:test -- \
  --target http://localhost:5273 --api-url http://localhost:4100 \
  --livekit-url ws://localhost:7880 --workspace northwind \
  --api-log /private/tmp/spasht-walkthrough/api.log \
  --agent-log /private/tmp/spasht-walkthrough/agent-logs/agent.log \
  --experience both --max-minutes 7 --verify-timeout 90
```

These ports and log paths describe the existing walkthrough stack, **not universal defaults**. If it belongs
to another active task, first verify it can be reused; otherwise use the isolated LiveKit setup above plus
separate web/API/signal ports, a dedicated migrated test database, and a single agent targeting that LiveKit
and API. Point `VITE_API_BASE_URL` at that API. Do not use root `dev`/`agent:kill`/`signal:kill`: they stop shared
processes. Never run migrations concurrently with suites using the same database. Do not print `.env` contents.
The launcher intentionally does not provision databases, change feature flags, seed production content,
accept invitations or kill/start services behind your back.

- Omit `--workspace` for Personal. Organizations are entered using the normal workspace picker and UI links,
  not inserted browser state. Refresh/deep-link coverage is separate and must also be checked when affected.
- Supply `--auth-file .auth/<private-session>.json` when not using the default target-specific state.
- `--experience interview|elevate|both` selects the default set (both = `confident-interview`,
  `manual-interview`, `elevate-learner`); repeat `--scenario <id>` to choose exactly. `manual-interview` uses
  `--manual-auth-file` (default `.auth/manual-<host>_<port>.json`). Automatic and manual Interview coverage are
  separate scenarios with separate reports; neither certifies the other.
- Preflight (`npm run voice:help` lists every option) reports each item with an evidence level:
  **reachable** (endpoint answered), **configured** (provider lists the configured model; processes target
  this stack's API/LiveKit — web→API, API→LiveKit, agent→LiveKit and API callback; exactly one agent worker on
  that LiveKit; Interview coverage of the default selection meets the scenario; account mode matches),
  **observed-registered** (the agent log shows registration with this LiveKit after its latest worker start, no
  later failure, log fresher than the process). It also records each component's revision status and checks
  authentication, Elevate/Interview access, workspace scope and frontend API binding in the real browser, per
  account. **verified-by-live-audio** is never claimed by preflight: only a run's live-audio checks prove that
  the agent was dispatched, spoke, and heard the candidate. An old registration line or a healthy HTTP endpoint
  is never treated as dispatch.
- Not verifiable automatically (state in your report): running code equal to a commit when its directory is
  dirty, components inside containers, provider generation quality, physical devices, production readiness.
- A scenario counts as passed only when its process exits 0 **and** its `report.json` says `passed`; a run that
  exits without writing a report (e.g. an unsettled await after the whole-run watchdog) is recorded as inconclusive.
  Each reply decision is also bounded independently of the provider timeout.
- `preflight` is **preflight-only**, never a passed end-to-end test. Missing prerequisites exit 2 with actionable
  diagnostics. Live outcomes retain CLI exit codes 0/1/2/3; both scenarios are attempted even when one fails.
- Conversation defaults to 8 minutes (12 for `manual-interview`), maximum 20 through the launcher, with bounded
  provider budgets and verification (1–600 seconds). Every run also has a whole-run watchdog (`--run-timeout`,
  default conversation + 2 × verification + 6 minutes) that closes the browser and still writes the report; the
  launcher adds an outer kill deadline. Timed-out, interrupted or unfinished runs are never passed. No automatic
  session retries; the launcher passes `--close-unfinished` so a leftover practice is ended through the UI.
- Evidence is saved only below ignored `tools/voice-test-candidate/runs/workflow-*/`: individual run reports,
  original audio evidence/conversation/trace plus `workflow.json` and sanitized API/agent run-window log tails
  (at most 256 KB each). A truncated tail is not a complete log; inspect the originals privately when needed.
  Direct CLI users should also retain the default ignored output. Never commit state, logs, audio or recordings.
- Review the report, independent conversation, incoming/microphone audio, screenshots and log excerpts.
  Preserve failed evidence; fix in-scope issues and rerun affected scenarios. Do not weaken required checks.
  Report the tool revision, app revision (or explicitly unknown if reusing an unversioned running stack),
  selected workspace/account role, scenario, outcome, evidence path and limits. Scores/subjective quality,
  physical microphone/speaker paths and room acoustics remain outside this tool's coverage.

Production remains forbidden without explicit authorization from the user. `--allow-production` is an
additional technical guard, not authorization. The workflow also rejects other remote endpoints by default
and refuses a frontend bound to a different API. Do not use a local proxy to bypass this boundary.
