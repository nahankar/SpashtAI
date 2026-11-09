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

The 9 November normal Admin allowance was consumed by policy 13. No v14 provider call has been made and no
limit reset/new actor/prior-day allowance is used. An available normal allowance or explicit approval for
up to 20 additional local calls is needed. Any override is confined to the isolated process/database;
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
