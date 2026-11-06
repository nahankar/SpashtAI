# Policy 10 candidate — 6 November 2026

Preview only. Policy 8 remains current; no promotion, merge, production change or adaptive enablement.
The frozen local tests have now completed: **HOLD**, with exact-repeat instability and a reasoning regression.
See `INTERVIEWS-GRADING-POLICY-10-RESULTS.md`; a passing repeat batch alone is not an overall pass.

## Diagnosis before changes

Claim-parser acceptance/rejection conditions are unchanged. Rejections now expose bounded, content-free
diagnostic codes (coverage, truth/reasoning conflict, duplicate quote, depth and required-gap conflict) instead
of only INCONSISTENT. Error messages, prompt/config entries and outcomes of older versions remain unchanged.
No rejected provider text is logged or retained.

Two normal, accounted retries of the failed v9 jobs both reproduced:

- RS-03: `INVALID_OUTPUT_CLAIM_CORRECT_WITH_GAPS`.
- H1-11: `INVALID_OUTPUT_CLAIM_CORRECT_WITH_GAPS`.

Thus the model produced correct/complete coverage plus required gaps; the server correctly rejected that
contradiction. This conclusion comes from observed guards, not an inference from the old aggregate error code.
The diagnostic raw report contains cumulative usage of both original and retry invocations; only two calls
are new on this UTC day.

## New frozen candidate

`learner-evaluation-10` uses `interview-answer-12` with the same model, schema 5, rubric 4, evidence validation,
limits and claim-to-verdict rules as v9. It explicitly reconciles essential gaps with coverage, places optional
elaboration in guidance, and checks attempted subject propositions before treating fragments as empty.
There are no question-specific exceptions. Older prompt/config hashes are preserved. A correct claim can
still be incomplete; a vague or false technical statement is still a claim, not automatically no answer.

The prompt change is an unproven candidate until measured. It does not repair results by dropping missing
essentials or overriding model semantics after the fact. The consistency guards remain in force.

## Frozen local test plan

Fixture `interview-calibration-policy-10-focused-1.json` reuses existing labels unchanged:

- Ten regressions including all three blockers and reasoning, empty-answer and mixed-claim controls.
- Five previously frozen transfer cases; these are not fresh heldout domains or independent expert labels.
- Two deterministic, model-free controls.
- One additional exact trial for each of RS-03, H1-11 and P2-08. Reuse is not counted as a repeat.

Budget: two v9 diagnostic calls + fifteen initial v10 calls + three v10 repeat calls = **20 normal Admin units**.
No additional allowance, new identity, budget reset or changed cap. The prior day's explicitly approved extra
allowance is not reused. Retryable provider failures could consume this allowance sooner; any resulting missing
tests must be reported as blocked.

Exact trials use normal deletion of only the fictional local Admin test after its evidence is preserved, then
normal resubmission. This permits a new provider invocation for an otherwise deduplicated input. Usage remains
in the ledger and is never reset; answer/question/config hashes must match and assessment IDs must differ.
No learner practice or production row is deleted. Initial and repeated results are preserved separately.

Gate: all declared checks, preferred routing labels and usable grades must pass, and the three repeated verdicts
must agree with the first trials. Even a focused pass is not full calibration: omitted regressions, broader
repeatability, domain review and integrated learner/voice/workspace checks remain release prerequisites.

Structural validation before model calls: 107 focused tests passed; server build passed. See the follow-up
results section/report for actual model outcomes; preparation alone is not a passed semantic test.
