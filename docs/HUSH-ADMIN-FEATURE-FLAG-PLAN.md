# Hush Admin Feature Flag Plan

## Purpose and decision

Add Hush as an optional server-side audio-cleanup step for the live SpashtAI
pipeline. When enabled, Hush will process incoming microphone frames before
the existing SpashtAI VAD and STT stages. It is intended to reduce background
noise and competing background speech in the user statements shown by the
product.

The existing SpashtAI VAD, turn-detection level, endpointing behaviour, STT,
LLM, TTS, transcript handlers, pacing metrics, recording, and analytics remain
unchanged. The short-pause behaviour observed in the standalone Hush PoC must
not be carried into SpashtAI.

The initial scope is the `pipeline-bedrock` backend, which is the current
Transcribe, Nova Lite, and Polly path. Nova Sonic is out of scope for the first
release because it owns a different realtime audio and turn-detection path.

> [!CALLOUT] ⚠️
>
> Hush is server-side. Raw browser audio still reaches LiveKit before Hush
> runs. Hush reduces competing speech; it is not an enrolled speaker-identity
> system and cannot guarantee that all background speech is removed.

## Current SpashtAI path to preserve

For `pipeline-bedrock`, SpashtAI currently uses:

```text
Browser microphone -> LiveKit -> Silero VAD -> STT -> Nova Lite -> TTS
```

The voice backend factory deliberately separates live transcript segmentation
from response patience. Silero uses an approximately 0.8 second segmentation
silence, while the admin turn-detection level sets response endpointing to
1.25, 2, or 4 seconds, plus the configured dynamic range. This is the behaviour
to preserve.

With Hush enabled, the only intended difference is:

```text
Browser microphone -> LiveKit -> Hush -> existing Silero VAD -> existing STT -> Nova Lite -> TTS
```

Displayed user statements already derive from the live STT event path. When
Hush is enabled and applied before that STT input, visible statements should
contain less background speech. This is an expected reduction, not a guarantee:
a louder or closer background speaker can still leak into STT.

## Admin control and rollback

Add `hushEnabled Boolean @default(false)` to `VoiceConfig`.

The existing Admin Voice Backend screen will show a clearly labelled switch on
the Pipeline Bedrock card:

- **Off — baseline audio**: exact current SpashtAI session-start behaviour.
- **On — Hush cleanup before VAD and STT**: applies only to new live sessions.

Admin behaviour:

1. Saving the switch updates the Pipeline Bedrock configuration and records an
   `AdminAction` audit entry with the old value, new value, admin ID, and time.
2. Token issuance copies `hushEnabled` into LiveKit room metadata.
3. The agent reads the room-metadata value once at session start.
4. Changing the switch never mutates an active session. An affected learner
   gets the new setting only after starting a new session.
5. Turning it off is the immediate rollback for all newly created sessions.

The admin screen must show the active default and explain the new-session
boundary. It must not claim browser-side privacy.

## Implementation phases

### Phase 0 — compatibility spike

Do this before adding a production dependency or UI control.

- Verify that `livekit-plugins-hush==0.3.3` and its `FrameProcessor` work with
  SpashtAI's installed `livekit==1.1.7` and `livekit-agents==1.5.8`.
- Verify the supported way in Agents 1.5.8 to attach a server-side audio frame
  processor before VAD and STT. The PoC used Agents 1.8.3 `RoomOptions` and
  must not be copied without proof of compatibility.
- Reuse only the narrow Hush compatibility adapter and its pinned package,
  source, and ONNX model checks. Do not copy the PoC's VAD, endpointing,
  token-server, dashboard, or fake-STT code.
- Decide explicitly whether a contained LiveKit upgrade is required. If it is,
  make that a separate reviewed change with full regression coverage; do not
  bundle it into the Hush flag.

**Exit criterion:** a local SpashtAI agent receives Hush-processed frames
before its existing VAD while the disabled path starts exactly as it does now.

### Phase 1 — backend and configuration

- Add the Prisma migration for `VoiceConfig.hushEnabled`, defaulting to false.
- Add it to the voice-config API response, update allow-list, validation, and
  audit log.
- Include the resolved Boolean in `routes/livekit.ts` room metadata.
- Add a small, isolated `hush_audio.py` module in the agent. It owns the
  third-party plugin import, exact version pin, model/source integrity checks,
  one processor per session, health reporting, and cleanup.
- In `main.py`, create the processor only when room metadata says Hush is on.
  Attach it before the existing session VAD and STT path.
- When Hush is off, do not create a pass-through processor and do not change
  VAD, endpointing, STT, or `session.start` options. This keeps the baseline
  path genuinely comparable.
- If Hush has been enabled but cannot initialise or fails a health check, keep
  the learner session available on the baseline raw path, emit a prominent
  structured error/metric, and record `hushRequested=true`,
  `hushEffective=false`, and the reason. Do not silently claim Hush was used.

### Phase 2 — admin UI and observability

- Add the Pipeline Bedrock-only switch to `apps/web/src/pages/admin/VoiceBackend.tsx`.
- Require the existing admin authentication and use the existing voice-config
  API; no client-side feature flag or browser secret is introduced.
- In agent logs and session metadata, record:
  `hushRequested`, `hushEffective`, plugin version, model hashes checked,
  frame count, processing p50/p95, overruns, and initialization failure reason.
- Surface an admin-visible health status: **disabled**, **ready**, **active in
  new sessions**, or **fallback to baseline**.
- Ensure recordings remain labelled correctly: raw recording may still contain
  background speech even when displayed statements are Hush-cleaned.

### Phase 3 — tests

Automated tests must cover:

- Prisma default is false and existing active VoiceConfig rows remain baseline.
- Only admins can change the flag; every change creates an audit entry.
- Token/room metadata contains the resolved Boolean.
- Disabled sessions preserve current `build_session` VAD, endpointing, and STT
  configuration exactly.
- Enabled sessions install one processor, process frames before STT, and close
  it at session end.
- A failed Hush startup produces a labelled baseline fallback instead of an
  unavailable learner session.
- UI accurately reflects the server-confirmed value and says that changes
  apply to new sessions.

Run the existing agent, server, and web test suites plus a local LiveKit
integration test using the real SpashtAI pipeline. The integration test must
exercise both disabled and enabled fresh sessions, not an in-session toggle.

### Phase 4 — controlled evaluation

Use the current production-equivalent backend and exactly the same VAD and
turn-detection setting in two fresh-session modes:

| Mode | Audio path | Purpose |
| --- | --- | --- |
| Baseline | current audio -> current VAD/STT | establishes existing behaviour |
| Hush | Hush -> identical current VAD/STT | isolates the effect of cleanup |

Run at minimum:

1. Normal learner speech with natural short pauses.
2. Learner silent while a nearby person speaks.
3. Learner and nearby person speak simultaneously.
4. Quiet learner with louder or closer background speaker.
5. Fan, traffic, and keyboard noise.

For every run, retain the scenario, mode, current turn-detection setting,
expected learner sentences, false turns, missed learner words, leaked
background words, Hush p95 frame latency, and any fallback status. The
standalone PoC's human-labelled annotation design can be reused, but its
0.55-second VAD/endpointing metrics cannot be used as SpashtAI acceptance
criteria.

## Acceptance and release gates

Enable the admin flag only after all of these are true:

- Disabled mode is a verified baseline with no Hush dependency in the audio
  path.
- Existing SpashtAI response patience and short-pause handling are unchanged.
- Hush reduces background-only false STT/turn activity in the controlled runs.
- Hush does not materially increase learner word loss or false turns during
  normal speech and natural pauses.
- Hush p95 processing time stays safely below the audio frame budget and has
  no sustained overruns under expected load.
- Admin disable takes effect for the next session and is auditable.
- Monitoring can identify any session that requested Hush but fell back to
  baseline.

## Explicit non-goals

- No browser-side noise processing or claim that raw audio never reaches
  LiveKit.
- No replacement of the existing SpashtAI VAD or turn-detection policy.
- No in-session toggle, because changing only Hush while retaining VAD/STT
  state would make diagnostics and comparisons unreliable.
- No rollout to Nova Sonic until its separate realtime-model compatibility is
  tested.

## Rollout sequence

1. Merge with the flag defaulting to off.
2. Verify disabled production-equivalent sessions.
3. Enable only for an admin test account and run the controlled evaluation.
4. Review labelled results and operational metrics.
5. Enable for a small internal cohort if results meet the acceptance gates.
6. Keep the admin switch available as the rollback control during rollout.
