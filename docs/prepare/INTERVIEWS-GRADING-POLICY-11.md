# Interpretation-aware grading candidate — 8 November 2026

The owner accepts AI-led reference adjudication. See `INTERVIEWS-AI-ADJUDICATION-2026-11-08.md` for the reasoning,
primary-source checks and one explicit label/disposition change. This is not independent human validation.

Policy 11 is a separate preview; policy 8 remains current. No merge/deploy or adaptive enablement.

## Behavior and versioning

New prompt 13, schema 6 and rubric wrapper 5 separate literal transcript evidence from the model's interpretation.
Each claim retains an exact original quote, an interpreted proposition and LITERAL/NORMALIZED/UNCERTAIN status.
Confident normalization can be graded, with a transparent feedback note; it never rewrites the saved transcript.

Uncertain meaning produces `EVALUATION_REVIEW_REQUIRED`, no result/classification and no inferred knowledge gap.
It is nonretryable automatically, preserves the saved answer, is accounted as an invocation, and stays distinct
from unavailable service or invalid output. The playback message is shown only after End through the existing
finding visibility boundary. An ambiguous answer cannot be fed to adaptive selection as NOT_ANSWERED.

The original claim-to-verdict rules and exact-evidence checks remain in force. Earlier prompt/config versions
are untouched. Expected review is accepted only for predeclared cases; returning no grade for every answer fails
the fixture. Review outcomes are counted separately from usable grades and provider failures.

## Frozen first test round

`policy-11-ai-review-1`: 19 initial cases, including ten regressions, five frozen transfer cases, two ASR controls
and two deterministic free controls. P2-08 must receive ungraded review; other selected cases keep their earlier
expected labels/checks. `policy-11-repeat-1` repeats the three blocker inputs with fresh accounted invocations.
This needs 20 normal Admin units (17 initial + three repeats), with no changed cap or previous approval reused.
Exact trials preserve evidence before normal deletion/resubmission of the three fictional local Admin tests;
usage is retained and answer/question/config/input-key hashes must match. This is not production data cleanup.

The focused set is not all frozen regressions. Broader validation remains necessary before promotion, even if
it passes. No changed label is used to retroactively rewrite policy-10 failures as passes.

## Verification prepared

- 110 focused server tests passed, plus nine playback/history tests, server build, web typecheck and web build.
- Real SDK HTTP checks against the owned local Postman fixture passed four scenarios: valid current-policy grade,
  review-required candidate output, malformed JSON and HTTP throttling. This proves transport/error handling
  against stand-ins, not grading accuracy. See the simulation context.
- No real spoken scenario has been run for the candidate yet; preview grading tests use saved typed answers.
  Final integrated voice and workspace checks remain required before learner rollout.

Repeatable HTTP check (no real provider credentials/calls):

```sh
postman simulation run postman/simulations/interview-evaluator.sim.yaml --port 4931 --no-history --output ndjson
NODE_ENV=test INTERVIEW_EVALUATOR_TEST_ENDPOINT=http://127.0.0.1:4931/bedrock \
  node --import tsx apps/server/scripts/check-interview-evaluator-simulation.ts /private/tmp/evaluator-http-results.json
```

The server's simulation endpoint remains test-only and restricted to loopback. Keep captured traffic/auth/audio
out of Git. Use normal accounted calibration commands for real-provider results and report them separately.

## Observed model results — HOLD

Tested application code: `0b7e50b`, 8 November 2026 UTC. Real Nova 2 Lite calls used the existing
accounted ADMIN_TEST path and the normal 20-unit daily allowance; no limit reset or earlier allowance reused.

- Initial 19 cases: 17 model calls and two deterministic free controls. Nine usable grades, all nine matching
  their expected class; ten invalid outputs; zero validated review-required outcomes.
- Initial failure reasons: five `claims_invalid_type`, two `uncertainty_invalid_type`, one
  `depth_evidence_too_big`, two `CORRECT_WITH_GAPS`. Schema errors were not repaired into grades.
- Three fresh repeat calls: RS-03 graded CORRECT; H1-11 failed `CORRECT_WITH_GAPS`; P2-08 failed
  `claims_invalid_type`. These are not three stable grades. The expected ambiguous-answer review failed again.
- Provider failures/timeouts: zero. All twenty invocations have recorded token usage. Provider availability
  does not make malformed/contradictory assessments usable.

The reference dispositions were frozen before the calls. No expectation has been revised to rescue these
results. Policy 11 is rejected for promotion. The next separate preview addresses output transport and retains
all evidence and consistency validation; transport success alone cannot establish semantic reliability.

Private evidence (ignored, outside Git): `/private/tmp/spasht-grading-validation/policy-11-initial.json`,
`policy-11-initial-review.json`, `policy-11-repeat.json`, `policy-11-repeat-review.json`, and
`policy-11-repeat-audit.json`. Historical failed provider bodies are not persisted or published.

Additional checks at this code: full server 655 passed / 290 optional database tests skipped; full web
383 passed; builds/typecheck passed. These are separate from the failed real-model acceptance.
