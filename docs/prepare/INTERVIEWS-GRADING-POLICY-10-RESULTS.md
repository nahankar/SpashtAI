# Policy 10 findings — 6 November 2026

**HOLD.** The two consistent-output failures were corrected on the tested inputs, but grading remains unsuitable
for score-driven adaptive selection. Policy 8 stays current. No merge, deployment or learner enablement.

## Diagnosis and candidate

Tested application code and frozen fixtures: `b166468`, branch `codex/interview-grading-policy-10`.
Older prompt/config hashes remain unchanged. New diagnostic codes preserve rejection conditions and Error.message
while distinguishing the content-free reason for rejection. No raw rejected model output is logged.

Two accounted retries of policy-9 failures both produced `INVALID_OUTPUT_CLAIM_CORRECT_WITH_GAPS`: RS-03 and
H1-11. Those results claimed complete/correct understanding while simultaneously listing missing essentials.
This was directly observed with instrumentation, not inferred from an aggregate error.

Policy 10 introduces a separate frozen prompt to reconcile essential coverage with gaps, distinguish optional
elaboration, and recognize attempted technical propositions in fragmented answers. Same model, schema,
validator and claim-to-verdict rules as policy 9. The consistency guards were not weakened.

## Results and exact repeats

| Measure | Observed |
| --- | --- |
| Initial cases | 17: ten regressions, five frozen transfer cases, two free controls |
| Usable initial grades | 17/17 |
| Initial acceptable classification | 17/17 |
| Initial preferred classification | 16/17 |
| Initial cases passing every declared check | **16/17** |
| Exact second trials of three blocker cases | All three usable; all declared checks pass |
| Same classification on both trials | **2/3** |

| Blocker | Initial policy 10 | Exact repeat |
| --- | --- | --- |
| RS-03, implicit valid reasoning | CORRECT | CORRECT |
| H1-11, package/monorepo trade-offs | CORRECT | CORRECT |
| P2-08, substantive fragments | INCORRECT | PARTIAL |

RS-03 and H1-11 now produced usable correct grades in both trials, with no contradictory-output failure.
P2-08 was assessed as substantive in both trials rather than NOT_ANSWERED, but its verdict changed. The fixture
permits PARTIAL or INCORRECT, with PARTIAL preferred. That tolerance cannot resolve an adaptive decision:
the two grades imply different next actions. We did not change the reference labels after seeing results.

Exactness was verified against saved hashes: answer, question, config, input key and answer text all match;
assessment IDs differ, `reused` is false and new invocations are accounted. Initial evidence was preserved before
deleting only those three fictional local Admin tests through the owned service and resubmitting. Usage rows
and budgets were retained. No learner sessions, bank guidance or production rows were deleted.

## Remaining failures

1. **Initial P2-07 still fails VALID_REASONING_NOT_CREDITED.** The preferred PARTIAL classification is correct,
   but the implicit reason was left uncredited. Policy 9 credited it on the preceding comparison. The more
   explicit coverage prompt therefore has not demonstrated preservation of reasoning judgments.
2. **P2-08 is not stable enough to steer questions.** Identical input changed from INCORRECT to PARTIAL under
   the same pinned policy, even with temperature zero.
3. **Manual inspection found an ASR-related semantic problem in both P2-08 outputs.** The fixture identifies
   “Packed tables” as a mishearing of “fact tables”, yet both results explicitly treat that wording as subject
   error. The initial trial also treats vagueness/omitted explanation as misconceptions. These findings are
   recorded in addition to the predeclared automated checks; they were not used to relabel the cases or hide
   failures. Not returning NOT_ANSWERED is an improvement, not proof of a sound grade.

The repeat-only review file says SAMPLE_PASSED_REVIEW_STILL_REQUIRED because each repeat individually satisfies
its declared checks. The combined verdict is HOLD because the initial reasoning check fails and the pairwise
classification is unstable. Do not present that repeat-only result as an overall pass.

## Budget and validation

Today's normal allowance was sufficient: two v9 diagnostic retries + fifteen initial v10 calls + three repeat
calls = **20 model invocations**. Two deterministic controls cost no model calls. No extra allowance, cap change,
budget reset, second identity or reuse of the previous day's approval. Today's Admin/global used counters are
both 20. Diagnostic raw rows include original invocations from the prior UTC day; only the latest usage row
per diagnostic assessment counts toward today's total. See the summary JSON for exact token accounting.

Runtime: restricted `walkthrough_app`, isolated `spasht_grading_validation`, local port 55443, real Bedrock saved
Admin-policy preview path. No API/web/agent/LiveKit processes were started for these grading tests. No production
calls. All benchmark processes exited. No extra provider calls after the allowance was consumed.

Structural checks: **652 server tests passed**, 290 optional/database tests skipped; server build passed.
No integrated learner/microphone run or full database integration suite was performed. Saved typed answers isolate
the evaluator and cannot certify capture, voice progression or playback. This focused set also omits other original
regression/transfer cases; it is not a full-policy acceptance run or an independent expert calibration.

## Evidence

Committed files under `calibration/2026-11-06-`:

- `policy-9-diagnostics.json`: precise reproduced rejection reasons; cumulative per-assessment usage.
- `policy-10-initial.json` and `policy-10-initial-review.json`.
- `policy-10-repeat.json` and `policy-10-repeat-review.json`.
- `policy-10-repeat-verification.json`: exact input verification and differing verdict.
- `policy-10-summary.json`: quota, token accounting, fixture hashes, combined HOLD and manual findings.

Private launchers and logs remain under `/private/tmp/spasht-grading-validation/`; no auth, secrets or recordings
are committed. Reproduce the offline reviews using `review-interview-calibration.ts` with the matching
`policy-10-focused-1` or `policy-10-repeat-1` fixture. The initial review exits 1; the repeat-only review exits 0,
but neither changes the combined decision.

## Next corrective step

Do not promote policy 10 or continue appending instructions merely to make this narrow set pass. The next
candidate should separate interpretation of possibly misheard technical terms from evaluation of the underlying
claim, retain uncertainty rather than penalize a transcription substitution, and tie reasoning judgments to
reviewed essential mechanisms. It needs comparative tests on both fragmented and clean answers, plus exact
repeats and the omitted regression cases within a normal or explicitly approved future allowance.

Expected outcomes still need independent domain review before calibration can be claimed. Grade-driven routing
and generated follow-ups remain off. Missing, unstable or ambiguous results must not drive a harder/easier/topic
decision; neutral bank fallback remains the safe design while selector plumbing is developed separately.
