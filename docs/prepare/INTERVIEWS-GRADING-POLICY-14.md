# Knowledge / reasoning separation preview — 9 November 2026

Preview only. Current learner policy is 8; no deployment, promotion or live adaptive selection change.
Amazon Nova 2 Lite remains the model (`us.amazon.nova-2-lite-v1:0`, us-east-1, temperature 0,
2,000 output tokens, 20-second timeout, one SDK attempt). Extended thinking is not enabled in this
experiment, so the contract change can be evaluated without changing model effort at the same time.

## Measured trigger and hypothesis

Policy 13 rejected R1-08's appropriate FALSE_CORE decision because the model also labelled a cited false
explanation as valid reasoning. This is separate from wrong core knowledge and must be visible as such.
The new contract distinguishes valid and invalid explanation evidence, never rewards false reasoning,
and retains a structurally supported primary grade when optional reasoning is invalid/conflicting.
This does not claim to fix policy 13's ambiguous-transcript, ASR, mixed-credit or feedback errors.
The same frozen labels and checks remain. Improved primary-grade availability alone is not acceptance.

## New pinned contract

Policy 14 / prompt 16 / schema 8, keeping rubric wrapper 6 and deterministic passage IDs unchanged.
Required fields: decision, correct, incorrect. Optional reasoning fields: validReasoning, invalidReasoning.
Optional reviewReason and feedback retain their previous purpose. Legacy reasoning is not accepted in v14.
Earlier prompts/configurations/parsers remain frozen; current policy does not move.

- Valid reasoning cites original passages also labelled correct. Explicitly false explanations cite passages
  also labelled incorrect and receive NOT_MET. Both can coexist as PARTIAL reasoning; omissions stay unassessed.
- Malformed/out-of-range/duplicate reasoning references are discarded and marked REASONING_INVALID_OUTPUT.
  References conflicting with knowledge evidence receive REASONING_CONFLICT. Neither acquires valid-reason credit.
  The core verdict is retained with a server-authored note and assessmentIssues; it cannot pass adaptive acceptance.
- Core evidence references, decision/coverage contradictions, injected server metadata and contradictory
  NO_SUBJECT evidence still reject the core result. Genuine REVIEW publishes no grade and requires its reason;
  it does not depend on optional reasoning formatting. No knowledge verdict is silently upgraded or invented.
- The server validates/copied source passages and result consistency as before. Presentation formatting is
  independent. Semantic truth, meaningful core coverage and ASR interpretation still require measured judgment.

Config hash: `fee67206563c902974f4b35e7fc8a9080e2126375c6d4b10cf82a492d337265d`.
Prompt SHA256: `4eb18d7e0f6f5c830c9a48b8e0aa8a46c445932c6e0d2b1ef313b6ea12ba7b2f`.
Tool schema hash: `1539a0976fe79f0af9611b80fb9e26e5c944a855e5c0ba2bf74ca5a553ae5ece`.

## Shadow routing policy, deliberately unwired

`evaluator/routing.ts` proposes actions without choosing/generating a question, writing learning state or
calling a model. No current route/worker imports it. It is a tested future boundary, not live adaptation.

- Repeat, skip, pause and explicit decline remain distinct controls and never update knowledge.
- Unknown/incomplete capture, pending/failed/cancelled results, any error, absent result or assessmentIssues
  hold progression. Capture completeness is separate from optional ASR confidence; missing confidence is
  not automatically a transcript gap or permission to assume correctness.
- Request-only assessment requires actual control intent instead of guessing repeat versus skip.
- DONT_KNOW can suggest the next topic without treating it as a false belief. An untagged NO_SUBJECT answer
  suggests clarifying the response, with no knowledge update; it cannot automatically lower difficulty.
- Only a complete usable assessment proposes deepen/clarify/simplify. Release readiness, eligibility, bank
  coverage, timeout and workspace authorization remain caller responsibilities before any future integration.

The benchmark now records coreGradesRequiringHold separately. A matching classification with assessmentIssues
fails ASSESSMENT_REQUIRES_HOLD and cannot make allRoutingLabelsMatch true. This prevents counting a retained
provisional grade as a fully passed assessment or adaptive-ready result.

## Frozen next provider round

`policy-14-focused-1`: identical eighteen answers/labels/checks to policy 13, including two free controls.
`policy-14-repeat-1`: the same four critical repeats. Sixteen initial model calls + four fresh repeats = 20.
Keep first-trial evidence before replacing only owned fictional Admin snapshots; preserve quota and verify
answer/question/config/input-key hashes. No case or label is changed because v14 retains more core grades.

At freeze, the normal 9 November allowance had been consumed by policy 13. The owner subsequently approved
20 additional local calls for this batch. Observed results below retain every failed case. Any override is
confined to the isolated process/database;
source/production limits and the global cap remain unchanged. No high-effort or unbounded thinking experiment.

## Validation and release limits

Focused evaluator, routing and offline-review tests passed (140). Server build and strict checks of the
three calibration/HTTP scripts passed. Actual SDK HTTP against the owned loopback fixture passed nineteen
assertions: valid old policies, held core result, explicitly false reasoning, malformed optional reasoning,
review, core rejection, and expected provider/error handling. These are authored fixtures, not model accuracy.

The parallel full server run had one unrelated Replay test timeout at its unchanged 5-second limit;
712 tests passed and 290 optional/database tests skipped. The serial full rerun passed all 713 tests (290 optional/database tests skipped), without changing any
timeout or Replay implementation. This is the successful full-suite result; the initial timeout is retained
in its original log.

Private evidence: `/private/tmp/spasht-grading-validation/policy-14-focused.log`, `policy-14-server-tests.log`,
`policy-14-server-serial.log`, `policy-14-http-results.json`, `policy-14-simulation.ndjson`.
No auth state, credentials, rejected model bodies or recordings belong in Git. This work changes preview
grading and an unwired routing proposal only; no voice stack or actual spoken flow was changed. Broader
frozen grading, repeated reliable routing and real candidate voice/workspace tests remain release prerequisites.


## Observed provider round — HOLD

Tested revision `ee36f99709fb95bda8b6ffcd621645cbed07b458`, clean at launch, on 9 November 2026 UTC.
The frozen eighteen-case initial run used sixteen real provider calls and two free controls; the four
critical repeats used four fresh provider calls. Saved typed ADMIN_TEST inputs are not a spoken test.

| Measure | Initial | Repeats |
| --- | ---: | ---: |
| Cases | 18 | 4 |
| Model invocations | 16 | 4 |
| Usable core grades, including free controls | 15 | 4 |
| Core grades marked for reasoning hold | 0 | 0 |
| Classification within accepted labels | 13 | 3 |
| Preferred classification | 12 | 3 |
| All declared checks pass | 10 | 2 |
| Invalid outputs | 3 | 0 |
| Expected review matched | 0 of 1 | 0 of 1 |
| Provider failures/timeouts | 0 | 0 |

Initial model-only grade availability was **13/16**, not 15/16: two completed outcomes were deterministic
free controls. Better core availability is not a semantic reliability pass. No retained-with-hold result was
observed in this batch; unit and HTTP checks cover that fallback and forbid counting it as adaptive-ready.

R1-08 now passes initial and repeat: the false core verdict is retained with an explicitly false reasoning
assessment, rather than being discarded for contradictory reasoning. H1-09 (relevant incomplete suggestion)
also passes twice. Empty slogan RS-02 and instruction echo P2-02 pass the initial tests.

Remaining initial failures:

- H1-11, RS-05 and R1-01: INVALID_OUTPUT_SCHEMA_incorrect_invalid_type. The field was missing or mistyped;
  the rejected body is not persisted, so its precise shape is not asserted. No default empty list fabricated.
- P2-07 and RS-03: valid implicit reasoning not credited. P2-07's repeat additionally has forbidden feedback
  wording; its PARTIAL class is stable but the assessment does not pass.
- P2-08: ambiguous technical attempt is again classified NOT_ANSWERED, rather than producing ungraded review.
  The repeat has the same wrong disposition. Stable error is not successful repeatability.
- A1-01: clear misheard-but-correct git-bisect answer is INCORRECT, outside accepted labels, with forbidden
  transcription-related criticism. A1-05, the actual incorrect-ASR control, is correctly INCORRECT this time.
- P2-06: INCORRECT (inside its historical broad band but not preferred PARTIAL) and missing credit for its
  true composition concept. A broader accepted band is not a justified adaptive action.

All four repeats use fresh assessment IDs (`reused: false`), matching answer text and answer/question/config/
input-key hashes. All four primary labels are stable, but only R1-08 and H1-09 pass every declared check;
P2-07 and P2-08 fail. No label/expectation was changed to accommodate these results.

Quota reconciliation: exactly **20 additional calls**, daily Admin and global counters both moved from 20
to 40. The private isolated process alone used ceiling 40; source/production per-Admin 20 and global 100 were
unchanged. The process exited. No reset, new actor, prior-day allowance or production model call was used.
All twelve required pinned questions were present, approved and active at their reviewed revisions.

Private evidence under `/private/tmp/spasht-grading-validation/`: `policy-14-initial.json`,
`policy-14-initial-review.json`, `policy-14-repeat.json`, `policy-14-repeat-review.json`,
`policy-14-repeat-audit.json`, `policy-14-repeat-verification.json`, `policy-14-budget-reconciliation.json`.

**Decision:** targeted core/reasoning conflict improved; overall grading and adaptive production release
remain HOLD. Do not promote this preview or count structurally valid wrong grades as a pass. The next
experiment should keep this exact prompt/schema/fixtures and test a separately pinned, bounded LOW extended-
thinking configuration on Nova 2 Lite. This investigates model effort without another prompt rewrite or
switching outside AWS. It needs its own approved call/token/time budget before execution. No such call is
included in this batch, and no broader/voice acceptance has been established.
