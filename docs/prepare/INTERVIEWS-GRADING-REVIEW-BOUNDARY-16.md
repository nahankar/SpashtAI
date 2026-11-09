# Review-boundary preview 16 — 9 November 2026

**Parser fix locally verified; semantic reliability remains HOLD.** No paid calls, production changes,
learner-policy change or adaptive enablement. The measured policy-15 run stays frozen and unrescored.

## What was fixed

Policy 15 declared UNCERTAIN on both ambiguous inputs but alternated between a valid ungraded review and
`INVALID_OUTPUT_SCHEMA_interpretation_summary_too_big`. The optional presentation purpose of a summary
had become a prerequisite for honoring the safety status. That is a caller-boundary defect separate
from the model's grading decisions.

New inactive config `learner-evaluation-16` uses `interview-result-10`. Model, prompt 17, rubric 6,
provider-facing tool schema, temperature, LOW thinking, 15,000-token cap and 40-second timeout are
**identical to policy 15**. A unit test compares the complete outgoing provider requests for equality.
Only persistence identity and the local parser version change. Config hash:
`0f6f309aec2d53806612cac4180f1b4349b6dca98c4681fe1e6e5f93ebe0148a`.

Required status, source IDs, decision and all four core/reasoning evidence lists remain strictly checked.
Unknown fields, wrong types, duplicate IDs and unsupported references still fail closed. An UNCERTAIN
status with valid critical fields still yields nonretryable `EVALUATION_REVIEW_REQUIRED`; it never yields
a grade. Invalid critical fields cannot be excused by an uncertainty signal or malformed summary.

The summary is now presentation only. Missing, oversized or malformed summaries are discarded, without
raising the allowed generation/request limits. They are never repaired, quoted, logged or persisted.
For CLEAR/NORMALIZED with a valid assessment, the primary grade remains identical; a content-free
validation note says the summary was unavailable. Normalization does not upgrade the grade. Existing
reasoning-conflict hold flags and exact original-evidence checks are unchanged. Policy 15/v9 continues
to reject the oversized summary as recorded; no historical result is retroactively called a pass.

## What the source audit established about the semantic failures

The exact baseline question text/guidance was inspected from the retained local bank snapshots. This
identified input conflicts and remaining model judgment problems; it does not prove which input field
caused a particular output. See `calibration/question-scope-proposal-1.json` for the AI-reviewed proposal.
It has not been applied to any bank, database, runtime mapping or production configuration.

1. **Fact versus dimension, DE-NEW-001:** the question asks for the distinction. The bank's Core also
   says to give an example and explain how grain permits safe aggregation; expectedDepth repeats the
   example requirement. N15-01 correctly describes measurement grain and descriptive context, but feedback
   demands the extra aggregation explanation. Removing only expectedDepth would leave that demand in Core.
   The next bank revision should separate asked essentials from optional depth, rather than adding another
   prompt instruction to ignore its input.
2. **Stale elements, AUT-NEW-005:** the question asks cause and sound recovery. The model explicitly
   acknowledges those true parts in N15-08 while grading the added false wait/reattachment claim as
   FALSE_CORE. The result should not be upgraded automatically merely because it lists a strength: an
   incidental true statement can coexist with a genuinely false central claim. This case has meaningful
   correct cause/recovery, but that distinction remains semantic. Generic depth demands about refuting
   a supplied misconception and detailed failure boundaries should not become unrelated requirements.
3. **CompletableFuture, DEV-NEW-016:** the question really does ask four API/handling areas. P2-06 covers
   only dependent composition and adds a false recommendation. Missing requested areas are real gaps;
   preserve the correct part without pretending the response is complete. The existing broad accepted
   INCORRECT/PARTIAL band is not a unique adaptive action; preferred PARTIAL remains unchanged in the
   historical fixture.
4. **Keyboard order, WEB-NEW-099:** the question asks natural order and why positive values are discouraged.
   Its reference checklist also adds tabindex zero/minus-one, focus indicators and other accessibility
   advice. Those extras should be optional unless specifically asked. P2-07 now receives reasoning credit
   but moves inside its existing PARTIAL/CORRECT accepted band. A preferred label is not independent
   semantic truth: resolve the completeness boundary explicitly before using it to select questions.

These are owner-authorized AI technical judgments, not independent human/domain-expert validation.
The bank proposal preserves domain truth and question text, including real missing-coverage requirements.
It does not edit old revisions, relabel outputs, hard-code answers, normalize arbitrary terms by qid, or
change the scorer to accept every answer with any correct fact. It is a reviewable artifact for the
normal question-authoring/approval workflow, not application code that overrides specific test cases.

## Validation completed

- Focused: **160 tests passed**. Includes old v9 rejection versus new v10 ungraded review; missing/null/
  oversized/object/array summaries; unchanged valid grades; strict critical-field failures; original
  quotations; summary/hidden-reasoning exclusion; retained reasoning holds; identical model requests.
- Full server suite, serial: **763 passed, 290 optional/database tests skipped**.
- Server build and strict standalone HTTP-check script typecheck passed.
- Actual AWS SDK HTTP against the owned local stand-in: **33 assertions and 33 request events passed**.
  Eight added checks include the original v9 failure and v10 overlong/missing/malformed summary handling,
  normalized grades, rejected missing reasoning, and rejected unsupported uncertain references.
- The stand-in authored these outputs. This proves caller/parser behavior only, not a new real-model
  classification, uncertainty, latency or cost result. Rejected policy-15 raw responses were not retained,
  so this is reproduction by failure class, not a byte-for-byte replay of those responses.

Private evidence in `/private/tmp/spasht-grading-validation/`: `policy-16-focused.log`,
`policy-16-server-serial.log`, `policy-16-build.log`, `policy-16-script-typecheck.log`,
`policy-16-http-results.json`, `policy-16-simulation.ndjson`. The evidence directory is mode 700.
The owned fixture on 4931 was stopped; shared services were not stopped or reconfigured.
Credentials, auth state, recordings and hidden reasoning are not committed. No API/agent/voice stack
was started. This preview does not change live voice conversations; no spoken validation is claimed.
Integrated adaptive rollout still requires actual automated voice/workspace tests and semantic validation.

## Next validation, without another blind prompt rewrite

First review/apply question-scoped essentials through the normal bank workflow **only in the isolated
validation database**, preserving previous revisions. Freeze new question revisions, hashes and acceptance
cases before any model call. Separate a model's coverage errors from rubric overreach and from the local
summary boundary. Include concise correct, clearly false, mixed-core, incidental-true/false-core, implicit
reasoning, empty-reason, instruction-echo and ambiguous-speech controls. Preserve the original failures.
The mixed/incidental distinction must not be “fixed” by blanket promotion or by labeling all mixed answers
uncertain. Likewise, any failure is not a correct safe-review outcome.

The parser-only change needs no further paid call to prove its local boundary behavior. To measure revised
bank inputs, use a separately versioned candidate and bounded real-model run, reporting semantic checks,
preferred routes, review correctness, availability, repeats, and token/latency usage separately. No new
paid allowance has been requested or consumed in this work; the previous allowance ended at day usage 80.
No caller fix or bank proposal makes adaptive Interviews ready for production.

Reproduce free checks from this worktree:

```sh
npm --workspace apps/server test -- test/interview-review-boundary.test.ts test/interview-interpretation-first.test.ts test/interview-separated-grading.test.ts test/interview-evaluator.test.ts
npm --workspace apps/server test -- --no-file-parallelism
npm --workspace apps/server run build
postman simulation run postman/simulations/interview-evaluator.sim.yaml --port 4931 --no-history --output ndjson
```

In another terminal, while that owned fixture is running:

```sh
env NODE_ENV=test INTERVIEW_EVALUATOR_TEST_ENDPOINT=http://127.0.0.1:4931/bedrock \
  node --import tsx apps/server/scripts/check-interview-evaluator-simulation.ts /private/tmp/policy-16-http-results.json
```

Stop only the owned fixture afterward. These commands do not invoke the real provider or deploy anything.
