# Workspace-safe recording recovery (D-1)

Implementation branch: `codex/interviews-recording-recovery-workspaces`, based on `origin/main` `810a65b`.
Ported from `74d763d` (the earlier Personal-only recovery prototype); no old branch merge, schema change or deployment.

## Behavior

Elevate and Interviews share `SessionRecorder` and `useAudioRecording`. Each nonempty one-second MediaRecorder
slice is appended to an IndexedDB journal as well as the existing in-memory recording. On reload, online recovery
or a one-minute retry, abandoned slices are concatenated and sent to the **original session and segment** through
the existing idempotent upload endpoint. Live recordings are excluded using Web Locks; without Web Locks a
recording entry must have been idle for two minutes. Stop/Leave uploads remain the normal path.

The journal key includes account, original workspace (or explicit Personal), session, segment and recording id.
Metadata stores workspace id/slug, never identity/workspace tokens. Before a recovery upload the identity token is
verified against the journal's account through identity-only `/api/auth/me`. This prevents stale UI account state
in another tab from attaching or deleting the previous account's audio after a token switch.

For an organization recording recovery requests fresh access through `/api/workspaces/entry/:slug`, checks the
returned organization id, and sends that token with the identity to the upload. It never accepts a membership,
changes the displayed workspace, or falls back to Personal. Suspended/removed membership or unavailable access
keeps the local audio for retry until expiry. Ambiguous journals from the pre-workspace prototype are not uploaded.

## Lifetime and failures

- Successful normal or recovery upload, deliberate discard, or a terminal upload response deletes the local copy.
- Offline/timeout/5xx/429 and identity/workspace access failures retain it for retry.
- Explicit sign-out starts no recovery uploads. It drops this tab's live journal and deletes abandoned journals
  for that account; storage events notify other live tabs to drop their own journals. Other accounts are untouched.
- Expiry is seven days, swept when recovery runs; it is not an OS-level scheduled deletion while the browser is closed.
- IndexedDB failure does not stop in-memory capture. A stored prefix remains recoverable after quota failure.
- At crash time the current timeslice and queued IndexedDB writes can be lost. There is no zero-loss guarantee.
- A recovered prefix is only the captured readable portion, not proof of a complete answer/transcript. Existing
  transcript-integrity and server recording validation still apply.

## Validation

Tests: `recordingJournal.test.ts`, `recordingRecovery.test.ts`, existing recorder/identity/live-session tests.
Run from the repository root:

```
node node_modules/vitest/vitest.mjs run --config apps/web/vite.config.ts apps/web/src --maxWorkers=2
npm --workspace apps/web run typecheck
npm --workspace apps/web run build
```

Real voice and refresh/recovery evidence must be recorded for this branch, rather than reusing the prototype's
historical tone/reload evidence. The local stack uses API 4140, web 5323, signal 4051, LiveKit 8190 and the dedicated
`spasht_recovery_voice` database. Provider configuration is reused privately; no credentials are committed.

## Before production release

No production deploy or feature enablement is authorized by this implementation. Review/update the recording
notice and privacy wording to explain temporary browser audio, retention and sign-out cleanup before enabling
browser persistence in production. Persistence defaults off in production builds; enable only with
`VITE_RECORDING_RECOVERY_ENABLED=true` at build time after that review. Development defaults on. The prior prototype documented this same wording gap; its suggested wording
was not approved or published. Validate shared-device cleanup and the final integrated revision before release.

## Lost speech-save acknowledgment found during validation

The first manual voice run hit a LiveKit `Connection timeout` after the agent logged a saved SKIP drain receipt.
The browser previously stopped at the transport error without checking the durable receipt. The shared
`confirmedInterviewDrain` now checks the owned receipt endpoint for the original request id when RPC throws.
It accepts only the matching action, segment, request id and (for Finish/Skip) attempt. Missing receipts retain
the original failure; mismatched receipts still fail. Explicit recognizer errors such as `TRANSCRIPT_PENDING`
do not use this transport fallback. No recording/answer is marked saved without server confirmation.

Regression tests were run against the old helper first and failed, then passed with the fallback. This is a
separate small reliability change discovered during D-1 validation, not an adaptive-selection change.
