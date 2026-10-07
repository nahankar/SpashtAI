# Interviews Phase 1: shared live-session engine

Local branch: `codex/interviews-phase1-live-engine`, based on Phase 0 `9689a3f`.

The existing standalone Elevate, Communication Snapshot, Coach-launched Elevate and Prepare live practice now use the same live controller and room components. This phase adds no Interviews screens, navigation, routes, server or agent changes, database migrations or dependencies. History, Retain controls, Recommended Practice, result tabs, reports and PDF generation remain in Elevate.

`Elevate.tsx`: **3,522 lines before → 2,200 lines after**. Line counts describe source lines, including comments and whitespace.

## Module map

All paths below are relative to `apps/web/src/features/live-session/`.

| Module | Responsibility |
| --- | --- |
| `api.ts` | Authenticated segment creation/closure, token, dispatch, completion metrics/transcript saves and adapter requests; fetch, headers, clock and segment ID generator are injected. |
| `browser.ts` | Browser API instance using current auth headers, real clock and UUID generator. |
| `types.ts` | Live state, launch configuration, recorder port, adapter and effect contracts. |
| `controller.ts` | Start, resume, pause and three audio recovery actions, disconnect deduplication, Leave/discard and room-prefixed message handling. No React or browser globals. |
| `adapters/elevate.ts` | Original standalone/Snapshot session body, failed-start cleanup, discard and Pulse policy. Coach launches retain ordinary Elevate policy. |
| `adapters/prepare.ts` | Journey/stage association, secure journey discard and no-Pulse completion. |
| `completion.ts` | Existing end → text metrics → analysis → optional skip sequence. Runs through the activity adapter. |
| `useLiveSession.ts` | Stable controller, latest callback ports, `useSyncExternalStore` subscription and browser lifecycle hooks. |
| `useWakeLock.ts` | Acquire/release screen wake lock and reacquire when visible. |
| `useIdleWarning.ts` | Warning at 14 minutes; the 15-minute timer only logs. |
| `useUnloadTextMetrics.ts` | Existing keepalive text-metrics request on unload, including viewed-session behavior. |
| `useFallbackDispatch.ts` | Existing 15-second fallback dispatch and timer cleanup. |
| `navigation.ts` | Pure, tested read-only viewing rule and existing Coach/Elevate/Prepare results URL construction. The page still owns navigation and Coach action recording. |
| `components/LiveSessionRoom.tsx` | Existing LiveKit room subtree, recorder, audio bootstrap, controls and pause-failure panel. |
| `components/LiveKitConversation.tsx` | Existing data-message parsing, turn metrics, agent-ready detection and `lk.session` completion saves. |
| `components/InRoomControls.tsx` | Existing microphone, record and Pause behavior. |
| `components/ConnectionStatus.tsx` | Existing assistant connection state UI. |

The existing `lib/pauseCapture.ts`, `lib/elevateNavigation.ts`, `SessionRecorder`, `useConversationPersistence` and metrics hooks are reused without modification.

## Source mapping

Approximate old line ranges refer to `Elevate.tsx` at `9689a3f`.

| Old location | New location |
| --- | --- |
| 75–103; 122–148: segment helpers and completion saves | `api.ts` |
| 857–920: message handler | `controller.ts: handleMessage` |
| 930–1070: session URL effect | Viewing, URL repair, conversation loading and storage remain in the page; connection work calls `controller.resume` with the effect's AbortSignal. |
| 1110–1270: pause/resume and audio recovery | `controller.ts: pause`, `resume`, `retryPauseUpload`, `pauseWithoutReplayAudio`, `continueInNewSegment` |
| 1272–1382: wake lock, idle, unload and fallback dispatch | The four dedicated browser lifecycle hooks |
| 1384–1495: session start | `controller.start` plus Elevate/Prepare creation and compensation adapters |
| 1497–1532: disconnect | `controller.onDisconnected` |
| 1534–1695: Leave | `controller.leave` and `completion.ts`; result UI updates and Coach actions remain in the page. |
| 1701–1775: discard | `controller.discard` and adapter endpoints; dialog, history updates and navigation remain in the page. |
| 2494–2615: room JSX | `components/LiveSessionRoom.tsx` |
| 2664–2715: connection status | `components/ConnectionStatus.tsx` |
| 2717–3017: live conversation | `components/LiveKitConversation.tsx` |
| 3020–3170: in-room controls | `components/InRoomControls.tsx` |

## Controller and adapter API

`new LiveSessionController({ api, now, random, effects })` owns connection state. `getSnapshot()` returns an immutable snapshot reference until an update; `subscribe(listener)` returns an unsubscribe function. The thin React hook proxies current page callbacks rather than capturing outdated props.

Methods:

- `start(config, adapter)` creates session → segment → token; compensates failed joins.
- `resume(sessionId, signal?, fromHistory?)` creates a fresh room and segment. Manual resumes are guarded. History resumes accept an AbortSignal and generation guard so a cancelled Strict Mode attempt cannot install a late connection or clear replacement state. Cancelled/failed attempts close their segment as unavailable; they never delete the existing session.
- `pause(recorder)` settles the recording before segment closure and room teardown. Failed capture leaves the room mounted with the recovery panel.
- `retryPauseUpload`, `pauseWithoutReplayAudio`, `continueInNewSegment` retain the three existing recovery flows.
- `onDisconnected(recorder, { sessionId, segmentId })` handles each bound segment once, ignores intentional/stale disconnects, immediately enters resumable paused state and closes the recording afterward.
- `leave(recorder, adapter)` finalizes and closes the segment, clears live messages/metrics/storage, runs adapter completion and calls the page's `left` port.
- `discard(recorder, adapter, viewedSessionId?)` waits for server acceptance before stopping the recorder or clearing state. The override allows standalone completed results to be discarded without a live connection.
- `handleMessage(message)` drops paused messages and namespaces turn IDs by room. Agent turn messages remain UI-only (`persist=false`). Existing `lk.session` completion saves still send metrics then transcript.

`ActivityAdapter` currently provides `kind`, `preparationId`, `creationBody`, `createActivity`, `cleanupFailedJoin`, `discard`, `trackPulse`, `skipPulseCall`, `endBody` and `complete`. Its `complete` method can be replaced by a future activity-specific evaluator flow without editing the controller. The Prepare adapter overrides standalone creation, end and discard policy while retaining the completion sequence.

`LiveSessionEffects` exposes messages, metrics reset, toast/log, active-session storage cleanup, reward points and completion/discard callbacks. Browser implementation of these ports stays in the page/hook; the controller tests inject fakes. The page keeps its viewed-session ID independently from the controller's active connection ID so completed/admin views do not join a live room.

The controller intentionally retains the existing overlapping boolean flags instead of imposing one mutually exclusive phase enum: a pause failure has both a live connection and an audio-recovery panel. Existing UI behavior depends on that distinction.

## Preserved contracts

- Blank session name, focus area and focus context retain the original `null` fields in the session-creation POST. Populated fields retain their values. Room metadata remains server-owned; this refactor does not reintroduce null coaching metadata in token query parameters.
- `logEvent` names remain `elevate.session_join`, `elevate.session_join_failed`, and `elevate.session_leave`, with the same payloads.
- `spashtai_active_session` and `spashtai_session_timestamp` retain their set/clear points: the page's session-ID effect and successful history resume set them; stale 403/404 pointers clear them; Leave/discard clear them before completion processing/navigation. Pause/disconnect retain them. Existing completed-view storage behavior is retained.
- Leave remains recorder → segment closure → live cleanup → end/reward update → text metrics → analysis → optional Pulse skip → page result/Coach navigation.
- Ordinary Elevate and Coach launches track Pulse; Snapshot/booth analyze without tracking and call `/skip`; Prepare analyzes without tracking and never calls `/skip`.
- Error toasts and navigation timing remain as before, including existing HTTP-analysis-failure feedback. Changing that product behavior is outside this extraction.
- Recorder key remains segment ID; conversation key remains room name. Resumed `user_turn_1` cannot overwrite the previous room's turn bubble.
- Completed sessions and another user's in-progress sessions stay read-only. Existing Prepare direct-link URL repair remains in the page.

## Intentional request change

The token URL now contains **exactly `room`, `sessionId`, `segmentId`**, in that order. It never sends `turnDetection`, identity, user name, focus area/context, session name or booth/demo metadata. The unused client identity and viewed focus-context state were removed. Authentication headers and history AbortSignal remain attached. Phase 0 already derives identity, coaching metadata and the per-room Hush decision from authenticated, persisted server state.

## Intentional behavior changes

Apart from the token request above, the extraction makes two deliberate lifecycle corrections. Both remove double-handling of a segment that is already closed; neither changes a normal flow.

- **Leave during a pending pause.** If Leave finalizes and closes the segment while Pause is still waiting for its audio upload, the pending pause now stops when it settles. Previously it could close the same segment a second time and put the ended session back into a paused state. Covered by `pause.test.ts` ("abandons a pending pause when Leave ends the segment first").
- **Stale disconnects.** A disconnect event from a previous room after pause/resume is ignored, so it cannot pause the resumed room. Covered by `pause.test.ts` ("ignores intentional and stale disconnects after resume").

Adapters are built from closures rather than `this`-bound methods, so a destructured or passed-around adapter method keeps working (`adapters.test.ts`). The controller is created once through lazy `useState` initialisation instead of `useMemo`, which React may recompute.

## Deferred to Phase 3 (Quick Practice)

These are design improvements, not Phase 1 defects. They change ownership boundaries that the Interviews launch path needs, so they belong with the first interview adapter rather than in a behavior-preserving extraction.

1. **Bind the adapter at start.** Leave and Discard currently rebuild the adapter from page state at the time of the action (matching the previous page behavior). For Interviews, the controller should keep the adapter used by `start()` — and accept one in `resume()` for history resume — so completion, Pulse and discard policy cannot drift if page state changes mid-session.
2. **One owner for `sessionId`.** The page and the controller each hold a `sessionId`, synchronised through the `sessionChanged` effect, and the page still sets it directly for read-only/completed views. Make the controller the single owner of the live session id and keep the page's viewed-results id as a separate, explicitly named value.

## Phase 3 interview adapter extension

Once interview launch and evaluation endpoints exist:

1. Extend the activity kind and supply `createActivity` using the authorized interview launch endpoint instead of `/sessions`. The adapter must create the supplied activity ID (or normalize the launch contract to it) and throw on failure. Supply matching failed-start compensation. The controller already delegates creation and completion, so it does not need to know that endpoint.
2. Supply interview question-version/configuration snapshots and SESSION_ONLY or JOURNEY scope through that server launch contract. Do not infer activity policy from the engine's `module` field.
3. Provide interview discard/compensation endpoints and a `complete` implementation that queues/reuses the technical assessment. It must use the authoritative answer snapshot and input hash. Do not reuse communication-only completion as technical grading.
4. Set `trackPulse=false` and `skipPulseCall=false`; enforce those rules on the server and inactivity worker as well.
5. Wire page `left`/discard ports to the Interviews results/journey destinations and interview-specific copy, rather than Elevate's current results page. Activity-specific navigation stays outside the engine.
6. Add the Interviews Retain bucket and purpose-aware in-progress/abandoned-session handling with the first Quick Practice UI. This is not supplied by the live engine.
7. Add contract tests for the new adapter and keep existing Elevate/Prepare characterization tests passing.

This phase creates the reusable connection machinery. It does not yet make the Interviews launch endpoint, assessment queue or Retain bucket available.

## Verification

- Web: **185 tests across 24 files pass**, including **58 new tests** across seven live-session test files; tests run in Node with existing Vitest and no new browser/test packages.
- Web typecheck passes. ESLint: zero errors and one pre-existing Replay dependency warning. The Elevate `canDiscardPreparePractice` warning is resolved.
- Web and server production builds pass. Existing Browserslist/baseline-data and bundle-size notices remain.
- Server: **399 tests across 49 files pass**. The first run had 398/399 passing because the fresh worktree lacked its ignored `apps/server/audio_storage` runtime directory. Created that directory; a subsequent sandbox run could not open test-server ports (`EPERM`). The final run outside the sandbox passes all tests. No server/test source was changed.
- Controller tests cover empty/populated/Snapshot/journey/stage launches, failures at all three start steps for both adapters, double clicks, token failure, AbortSignal cancellation at segment/token boundaries, Strict Mode replacement, namespace collisions, paused-message dropping, assistant thinking stripping and duplicate suppression.
- Pause/disconnect tests cover pending and failed upload recovery, failed segment closure, intentional/stale and duplicate disconnects. Completion tests assert request order, points timing, Pulse policy, recorder failure, both discard endpoints/rejections and viewed-session discard. Navigation tests cover Coach/journey URLs and read-only view rules. Dispatch uses fake-time timer tests.
- These Node tests do not prove real microphone capture, LiveKit reconnection, agent greeting, browser permissions or production database effects.

Local browser setup: a new worktree did not include ignored web environment configuration. Copied the existing main checkout's `apps/web/.env` into the worktree and restarted Vite. Original environment files were unchanged. The original local API was stopped; started it from the main checkout using its existing configuration. Its health check passes and the browser reached Coach after the user's Google sign-in. This confirms local authentication, not live-session smoke coverage. No production service or schema was modified.

**Production baseline reported by the user:** mid-session refresh and Communication Snapshot were **not tested**; both remain pending. Do not treat assumed success as a passed check.

## Manual smoke checklist

All live checks below remain pending until observed and recorded by the tester. Run against the Phase 1 web checkout with the Phase 0 API/agent; record actual results before merge or deployment.

1. Blank-focus Elevate: coach greets within five seconds.
2. Recommended Practice: coach references existing communication practice/profile.
3. Pause/resume: fresh room and segment, prior bubbles preserved, session context remembered.
4. Mid-session refresh/history resume: reconnects without 409.
5. Network drop/recovery: disconnected banner and functioning Resume.
6. Failed upload: Retry, Pause without replay audio and Continue in a new segment all work.
7. Leave: playback results, expected Pulse feedback/entries and enabled points.
8. Discard standalone and unfinished Prepare practice; rejected discard leaves room intact.
9. Snapshot: no name, no Pulse entries; skip request present.
10. Prepare: start/Leave keeps journey results URL; no standalone Elevate history or Pulse entry.
11. Coach launch: Leave returns to `/coach?elevateResult=...&thread=...` and records completion.
12. Admin viewing someone else's unfinished session: read-only; no token/segment creation.
13. Database policy inspection: ordinary sessions COMMUNICATION/COMMUNICATION_PROFILE, Prepare INTERVIEW/JOURNEY.

The branch contains separate checkpoint commits only. No push, merge or deployment is part of this phase.

## Local code checkpoints

| Commit | Checkpoint |
| --- | --- |
| `a266ada` | Transport extraction and request characterization |
| `6072313` | Room components and browser lifecycle hooks |
| `e490c45` | Shared start/resume/message controller and hook integration |
| `e5f9e3d` | Pause/audio recovery and disconnect lifecycle |
| `57277a2` | Leave/discard completion and page callbacks |
| `d7ad022` | Exactly three token query parameters; dead client metadata removed |
| `e8355ed` | Adapter-owned launch transport; expanded failure, viewing and return-routing coverage |

The final documentation checkpoint records this module map, validation evidence and pending manual checks.
