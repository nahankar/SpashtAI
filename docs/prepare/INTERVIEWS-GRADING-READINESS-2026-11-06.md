# Interview grading readiness — 6 November 2026

**Decision: HOLD grade-driven adaptive selection.** The current grader is not reliable enough on this
regression sample to decide whether the next question should be harder, easier or a different topic.
No runtime policy, prompt, model, feature setting, bank publication or production deployment changed.

## What was tested

Application grading code: `810a65b` (`origin/main` when fetched). Policy `learner-evaluation-8`,
prompt `interview-answer-8`, schema `interview-result-4`, rubric `bank-guidance-3`, model
`us.amazon.nova-2-lite-v1:0`, temperature 0. This branch adds offline validation tooling and evidence only.

The existing calibration harness exercised normal persisted Admin tests previewing the exact learner policy:
enqueue, policy/role checks, quotas, worker claims, real Bedrock invocation, parser and saved assessment.
The restricted `walkthrough_app` role used only isolated database `spasht_grading_validation` on local port
55443. Approved local bank questions were copied with their existing guidance and revision 2; those rubric
fields were not edited. Production and other local databases were not written to.

The case selection was frozen before the run: all six `reasoning-1` cases, all five `pilot-2` cases, nine
`heldout-1` cases (01–06, 08, 10, 11), and two deterministic controls (explicit abstention and repeat request).
These cover correct/partial/incorrect answers, alternative wording, injected grading instructions, mixed
claims, fragmented transcripts, true/false/empty/implicit reasoning and no-answer distinctions.

**These are AI-reviewed bank-relative labels.** Historical heldout cases have been seen in earlier benchmarks;
they are regression cases now. There is no independent expert calibration, new heldout trial or repeated-run
stability claim. Saved typed answer tests isolate grading; they do not replace voice capture tests.

## Results

| Measure | Observed |
| --- | --- |
| Cases | 22: 20 model calls + 2 deterministic, model-free controls |
| Usable completed grades | 21/22; model path 19/20 |
| Classification within original acceptable labels | 20/22 |
| Exact preferred classification | 18/22 |
| Cases passing every declared semantic/evidence check | 14/22 |
| Forbidden classification | 1: P2-08, substantive fragments called NOT_ANSWERED |
| Invalid output rejected | 1: RS-06, INVALID_OUTPUT_INCONSISTENT; result null |
| Exact quotations in published completed grades | All |
| Model latency p50 / p95 / maximum | 2.477 / 3.184 / 7.669 seconds |
| Recorded tokens | 37,480 input + 6,494 output; no unknown usage |

The existing quota was unchanged: 20/20 per-admin units, 20/100 global units. No retries, quota resets,
additional identities or simulation endpoints were used. Two deterministic controls consumed no model budget.
The Admin preview stores `next: null`; no adaptive learner selection ran.

## Confirmed acceptance gaps

| Case | Finding | Adaptive risk |
| --- | --- | --- |
| RS-01 | False/irrelevant causal explanation received REASONING MET; PARTIAL vs preferred INCORRECT | False understanding can be rewarded |
| RS-03, RS-05 | Correct classifications, but valid implicit reasoning left NOT_ASSESSED | Reasoning-based routing would penalize valid explanations |
| RS-06 | Empty justification produced inconsistent output and no usable grade | Missing grades need a neutral fallback, never a fabricated low score |
| P2-06 | Mixed answer was INCORRECT and its correct composition concept was absent from strengths | Choosing solely from the verdict can erase demonstrated understanding |
| P2-07 | Correctly recognized the concept, then said reasoning was absent and required an example | Feedback and reasoning are not consistently aligned with the answer |
| P2-08 | Vague but substantive fragments classified NOT_ANSWERED | Could trigger an unjustified topic switch |
| H1-10 | PARTIAL classification but failed to identify the declared secondary misconception | A correct label alone does not establish diagnostic reliability |

Some reference cases deliberately allow more than one broad classification. That tolerance is useful for
grading review, but PARTIAL and INCORRECT would select different adaptive actions. An exact preferred-label
disagreement is reported separately, not silently promoted to model correctness or treated as settled expert
truth. Even the broad acceptable-label check fails here, and the independent reasoning/strength checks fail too.

The parser correctly rejected RS-06 rather than publishing contradictory feedback. Requests and explicit
abstention retained different server-owned response kinds. Existing worker/model contract tests passed.
Those safeguards help, but do not correct a structurally valid semantic misjudgment.

## Repeatable acceptance review

`apps/server/scripts/review-interview-calibration.ts` reviews every expected case, treats missing/failed results
as unavailable, rejects unexpected/duplicate rows, checks exact evidence and declared semantic expectations,
and exits 1 for a HOLD. Unlike the older harness's `reasoningCredited` field, a NOT_MET reasoning finding
does not count as credit for valid reasoning. Original raw harness metrics remain preserved in the evidence.
A small passing sample is labelled SAMPLE_PASSED_REVIEW_STILL_REQUIRED, never calibrated.

From the repository root, with the normal local Admin prerequisites and reviewed question revisions:

```sh
# Provider call: supply an authorized local Admin ID and private local DB/credential environment.
# Existing quotas and idempotent reuse apply. Do not reset budgets or silently count reused results as fresh runs.
node --import tsx apps/server/scripts/calibrate-interview-evaluator.ts LOCAL_ADMIN_ID /private/tmp/grading-results.json \
  --fixture readiness-2026-11-06 --model learner-evaluation-8

# Offline; no credentials, database or provider calls. Exit 1 is the expected result for this evidence.
node --import tsx apps/server/scripts/review-interview-calibration.ts \
  apps/server/test/fixtures/interview-calibration-readiness-2026-11-06.json \
  docs/prepare/calibration/2026-11-06-grading-readiness-results.json /private/tmp/grading-review.json

cd apps/server
node ../../node_modules/vitest/vitest.mjs run test/interview-calibration-review.test.ts \
  test/interview-evaluator.test.ts test/interview-evaluator-worker.test.ts test/interview-practice-contracts.test.ts
```

Checks: **89 tests passed**, server production build passed, and standalone strict TypeScript checks passed
for the new reviewer and tests (the server build normally includes only `src`). No application/voice code
changed, so no new voice scenario was run. Full database integration and infrastructure fault suites were
not rerun here; this result does not claim they passed on this branch.

Evidence committed alongside this report:

- `calibration/2026-11-06-grading-readiness-results.json`: persisted result bodies and raw harness metrics.
- `calibration/2026-11-06-grading-readiness-review.json`: per-case acceptance checks and HOLD decision.
- `calibration/2026-11-06-grading-readiness-provenance.json`: policy, quota, fixture and guidance hashes.

Private setup, log, source question export and database are retained under
`/private/tmp/spasht-grading-validation/` and the isolated database. No web, agent or LiveKit services were
started for this benchmark. No credentials, authentication state or recordings are committed.

## What must happen before adaptive enablement

1. Review the preferred labels, tolerated alternatives and misconception expectations against the bank.
   Resolve ambiguous labels with an independent domain reviewer before claiming calibration. An agent can
   prepare these cases, but cannot represent its own judgment as independent expert approval.
2. Improve grading as a **new frozen policy version**, preserving earlier run pins. Fix reasoning by meaning,
   mixed-answer credit and substantive/no-answer discrimination together. Do not rename the current policy,
   hide failed criteria or switch models without comparative evidence.
3. Validate on this regression set **and fresh, independently labelled cases**, then repeat critical cases
   within normal quotas to measure decision stability. Track unsupported credit, missed knowledge, invalid
   output, availability and latency separately. This run does not establish repeatability.
4. Bank-selector/idempotency/isolation implementation can proceed with grade-driven steering off. Missing,
   late, inconsistent, untrusted or incomplete-transcript assessments must use a neutral bank fallback.
   REQUEST_ONLY must not be interpreted as lack of knowledge. Do not map every NOT_ANSWERED to a topic switch.
5. Before enabling adaptive behavior, validate the integrated manual and conversation paths with real spoken
   answers using the current candidate tool and verify saved selection decisions, recordings and workspace
   isolation. Current evidence approves neither adaptive production use nor generated follow-up questions.
