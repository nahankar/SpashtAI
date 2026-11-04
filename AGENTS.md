# SpashtAI agent guidance

## Automated voice validation

For changes affecting Elevate or Interview voice conversations (including agent code, turn taking,
transcription, room/dispatch/authentication, recording, recovery, or voice UI), run the relevant scenarios
in `tools/voice-test-candidate/` before declaring the task complete. Read its README first.

- Use the real browser, listen to actual received app audio, and speak through the virtual microphone.
  API-only checks, injected transcripts, DOM-derived answers and seeded fixtures are not substitutes.
- Start or reuse an appropriate local stack whose checkout/revision, API, database, LiveKit dispatch,
  agent callback URL and selected Personal/organization workspace you have verified. Use dedicated ports,
  database and LiveKit when another worktree is active. Never use broad `pkill`, stop shared containers,
  or run root `dev`/agent kill scripts without inspecting their effects.
- Use `npm run voice:preflight -- ...` then `npm run voice:test -- ...` (see tool README).
  A green preflight checks prerequisites only; it is not a passed voice test or proof of agent dispatch.
- Choose relevant scenarios: Interview confident path plus hesitant/silence scenarios when changing
  transcription, progression or recovery; Elevate learner for coaching changes; both for shared voice code.
- Inspect `report.md/json`, `conversation.json`, actual incoming/microphone audio, screenshots and relevant
  API/agent logs. Diagnose failures, fix in-scope issues and rerun affected scenarios. Preserve evidence.
  Do not silently change the scenario or weaken checks to obtain a pass.
- Report scenario, target/workspace, tested app revision, outcome, evidence paths, log findings and coverage
  limits. Blocked, failed, timed-out, pending or inconclusive is never passed. An unresolved run means voice
  validation is incomplete, even if coding is finished.
- Do not ask the owner to do routine spoken testing the candidate can perform. Ask only for a specific
  prerequisite you cannot resolve (e.g. interactive Google login), physical hardware checks, or subjective
  judgments; explain exactly why automation cannot cover it. Reuse valid private test authentication.
- Keep runs bounded (time, turns and provider budget), default to local development, and never target
  production without explicit authorization for that run. Tool flags are not user authorization.
- Keep credentials and authentication state private; never commit tokens, `.env.local`, `.auth`, audio,
  recordings, screenshots or traces. Default evidence is in ignored `tools/voice-test-candidate/runs/`.
  Inspect redaction before sharing logs; do not print complete environment files or secrets.

The tool is a separate developer package and must not be included in application builds/deployments.
Existing `.cursor/rules/` and `.cursorrules` conventions still apply.
