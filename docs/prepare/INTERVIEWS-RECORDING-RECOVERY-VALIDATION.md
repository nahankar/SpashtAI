# D-1 recording recovery validation

Validated locally on 6 November 2026 (Asia/Kolkata). No merge, production deployment or production enablement.

## Revision and scope

Base: `810a65b`. Implementation: `942956e` (workspace/account-bound browser recording journal), then
`feaaa71` (verify the original durable Interview drain receipt after a lost voice RPC acknowledgment).
This report is documentation only; the tested application code is `feaaa71`.
The candidate tool was clean at `6c8b3f1` and was not edited.

The new branch is `codex/interviews-recording-recovery-workspaces`. This ports the earlier D-1 prototype
without merging its old branch. No schema changes, adaptive question selection or grading-policy changes.

## Automated checks

- Web: 66 files, **412 tests passed**.
- Web typecheck and production build: passed.
- Whitespace check: passed.
- Targeted lint retains the existing `AuthContext.tsx` fast-refresh export failure for
  `isGenuineIdentityRejection`; the same failure was reproduced on `origin/main`. Lint is not reported as passed.
- Negative control: the new receipt regression tests failed against the old helper (5 failed, 14 passed),
  then passed with the implementation. Explicit recognizer failures do not take the transport fallback.

Commands from the implementation worktree:

```sh
node node_modules/vitest/vitest.mjs run --config apps/web/vite.config.ts apps/web/src --maxWorkers=2
npm --workspace apps/web run typecheck
npm --workspace apps/web run build
```

Private check logs are under `/private/tmp/spasht-recovery-stack/logs/`, including `web-tests-pinned.log`,
`build-pinned.log`, `receipt-negative-control.log`, `lint-pinned.log` and `lint-auth-baseline.log`.

## Real spoken scenarios

The isolated stack used web `5323`, API `4140`, signal `4051`, LiveKit `8190` and database
`spasht_recovery_voice` on `55443`, with a restricted runtime role. Only fictional local accounts were used.
The tool verified web, API and agent source at `feaaa71`. Existing provider credentials were reused privately.

From `tools/voice-test-candidate` on the tool checkout:

```sh
npm run test:voice -- --target http://localhost:5323 --api-url http://localhost:4140 \
  --livekit-url ws://localhost:8190 --workspace northwind \
  --api-log /private/tmp/spasht-recovery-stack/logs/api.log \
  --agent-log /private/tmp/spasht-recovery-stack/logs/agent.log \
  --scenario manual-interview --scenario elevate-learner --max-minutes 12 --verify-timeout 150
```

Evidence root (ignored, local):
`/Users/neelesh.ahankari/Applications/SpashtAI/tools/voice-test-candidate/runs/workflow-2026-11-05T18-25-47-611Z/`.

- `20261105-182555-33c35e`: **manual Interview passed**, 17 required checks. Real speech, Finish/Next,
  Skip/Next, Finish/End, saved answers, recording, history and playback. Session
  `session_1793903158194_7qf5ymqjn`.
- `20261105-182816-d3c425`: **Elevate passed**, 13 required checks. Natural conversation completion,
  persisted replies, recording decoding, application playback and settled processing. Session
  `session_1793903299286_sjbompkj7`.

An earlier Interview failed with a LiveKit Connection timeout after the agent had saved the SKIP receipt.
That failure motivated the durable-receipt fallback and remains in the earlier evidence directory; it was
not relabelled as passed. An intermediate rerun was blocked by the unfinished practice and is also retained.

## Reload and actual renderer-crash recovery

Separate diagnostic hooks used the existing candidate audio bridge and real spoken reply, then deliberately
interrupted the scenario. These are **passed recovery assertions**, not passed complete conversation runs.
The tool itself was unchanged. Scripts and fault controls are private under `/private/tmp/spasht-recovery-stack/`.

Both probes blocked an upload, confirmed the journal survived, restored uploads and navigated from Brightpath
to Northwind. Recovery uploaded into the original Brightpath session/segment and removed the confirmed local copy.

- Reload: `runs/recovery-refresh-probe/20261105-181148-488b65/`; 40 journal chunks;
  session `session_1793902310322_p5dbuyyfk`. Its complete-scenario outcome is blocked by the deliberate navigation.
- Renderer crash: actual CDP `Page.crash`, observed crash event, replacement page in the same browser context;
  `runs/recovery-renderer-crash-probe/20261105-183632-5684ce/`; 38 chunks;
  session `session_1793903793908_hccoogj9k`. Its complete-scenario outcome is failed by the intentional diagnostic stop.
- Assertion summaries are in each probe parent directory as `assertion-summary.json`.

Both recovered files contain readable 48 kHz Opus packets and play in native browser audio. For the same
recording URL, Brightpath returned 200, Northwind 404 and Personal 403 (tenant-only account). Playback advanced
past one second. Private results: `recovered-media-isolation.json` and `crash-recovered-media-isolation.json`
under `/private/tmp/spasht-recovery-stack/`. The crashed prefix is an unfinished WebM and the container probe
warns about its premature end; browser playback succeeded. This establishes readable captured audio, not
zero loss or a complete session. Physical hardware/OS crashes were not tested.

## Release limits and next step

Browser persistence defaults **off in production**. Review the recording notice, temporary browser storage,
seven-day opportunistic expiry and sign-out cleanup before enabling `VITE_RECORDING_RECOVERY_ENABLED=true`.
The current timeslice and queued storage writes may be lost during a crash. Failed workspace authorization
retains local audio and never falls back to Personal. No tokens, credentials, recordings or authentication
state are committed.

Only this task's isolated services are stopped after validation; shared services and production are untouched.
Evidence and the isolated database are retained locally.

Grading semantic acceptance remains a separate prerequisite before using results to choose adaptive questions.
The historical Northwind third-turn miss is not claimed fixed by this work. Prepare and AI Coach for tenants
remain parked; the adaptive selection plan and parked-item list are on `docs/release-status-2026-11-04`.
