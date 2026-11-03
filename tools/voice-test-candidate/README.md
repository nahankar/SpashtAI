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

`.auth/`, `.env.local` and `runs/` are git-ignored.

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
get each other's sessions. To test this checkout without disturbing a stack already running elsewhere, give it
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

The server still uses `apps/server/.env` for everything else (database, AWS voice pipeline, JWT).

## Scenarios

| Scenario | Experience | Behaviour |
|---|---|---|
| `confident-interview` | Interview | Direct answers with one concrete example (40–75 words). |
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

**Outcome rules**: *passed* only when the application itself ended the session (e.g. "Practice time is up"),
the session was ended through the UI, and every required check passed. A run stopped by `--max-turns` or
`--max-minutes` is *inconclusive*, never passed. Results that do not appear within `--verify-timeout`
(recording, evaluation) are *pending* → *inconclusive*. Checks are labelled by basis: **browser** (displayed),
**audio** (measured), **api** (read-only API with the test session — diagnostic, not user-visible) or **tool**.
Evaluation checks confirm that results exist; scores are never judged. Answer relevance is advisory.

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
