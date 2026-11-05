# Claim-based grading candidate (policy 9)

Status: **preview only; real-model comparison completed, HOLD**. See
`INTERVIEWS-GRADING-POLICY-9-COMPARISON.md`. Current learner policy remains
`learner-evaluation-8`. Nothing merged, deployed or enabled for learners/adaptive selection.

The 6 November baseline found eight semantic/availability failures across 22 cases. Prior prompt-only
variants also failed; simply adding another causal-keyword rule is not evidence of a fix. This candidate
removes those accumulated hints and separates subject claim judgments from the overall verdict.

## Candidate contract

`learner-evaluation-9`: same Nova 2 Lite model, temperature, invocation timeout, token cap and deterministic
request/abstention controls; new `interview-answer-11`, `interview-result-5`, `bank-guidance-4`.

The model returns at most six quoted claim judgments, essential coverage, depth evidence, gaps and guidance.
It judges each claim's truth, central/supporting relevance, and reasoning validity by meaning. No causal-word
extractor supplies or credits reasoning. It must retain correct claims beside incorrect ones, distinguish
an empty slogan from a substantive false/vague claim, and preserve original transcript quotations.

The server derives the existing public result shape:

- No substantive claims: NOT_ANSWERED, all criteria unassessed, no strengths/misconceptions.
- False central claims without a correct central concept, or only false claims: INCORRECT.
- A correct central concept beside a false claim, or incomplete essential coverage: PARTIAL.
- Correct essential coverage without false claims or required gaps: CORRECT.
- Correct claim explanations become strengths; false ones become misconceptions. One cannot erase the other.
- Reasoning is derived from the per-claim judgments, including mixed/partial reasoning. Depth still requires
  explicit evidence; it is not hidden to manufacture a passing result.
- Changed/invented quotations, duplicate claim passages, incompatible truth/reasoning judgments, contradictory
  coverage and unsupported depth are rejected. The result passes the existing v4 validation boundary afterward.

This prevents some logical contradictions **conditional on the model's claim judgments**. It does not prove
those judgments are correct. A model can still miss or misjudge a claim; that is why promotion needs measurement.
No fresh numeric score, schema migration, additional provider call or adaptive selector was added to production.
Existing policy entries and prompt hashes are unchanged. The candidate is offered through the existing Admin
preview path, not selected for new learner practices.

## Tests and benchmark plan

Focused tests cover mixed answers, false central claims with true supporting detail, implicit valid reasoning,
empty justifications, substantive false answers, evidence validation, contradictory outputs, exact prompt
pinning and the model request/normalization boundary. **101 focused tests passed; server build passed.**
These are structural and mocked-provider checks, not semantic grading acceptance.
The broader server suite passed **646 tests**, with 290 optional/database tests skipped. The initial sandboxed
run could not open temporary test listeners; the rerun with local socket access passed. Database integration
and voice rollout checks remain separate gates.

Pre-registered fixtures (labels frozen before any candidate model invocation):

- Existing `readiness-2026-11-06`: 20 model cases plus two free deterministic controls; rerun on v9.
- New `policy-9-fresh-1`: eight new answer variants on previously reviewed questions; compare v8 and v9.
  The variants cover mechanism/contrast reasoning, incorrect confidence/injection, empty instruction echoes,
  directory permissions and mixed resource-hint claims. AI-authored labels are not independent expert review
  and these are not unseen question domains. Do not relabel failures after seeing results.

This comparison requires **36 additional model invocations** before retries: 20 candidate regressions,
eight candidate fresh cases, eight current-policy fresh cases. Record policy revision and hashes, persist
usage through the normal Admin job path and apply the offline acceptance reviewer to every case. Known
baseline outputs are reused only as labelled historical evidence, never as fresh repeated measurements.

The initial 20-call baseline exhausted this Admin's normal UTC-day quota. A normal candidate submission
was attempted and returned 429 before a provider call. No budget was reset and no second identity was used.
The owner subsequently approved **36 additional local calls**, and the full comparison completed within that
allowance. Only the isolated benchmark processes used a temporary Admin ceiling of 56 (20 existing + 36 new);
no usage was reset, no second identity was used, and normal source/production caps stayed unchanged. All three
processes exited. The observed result is HOLD, not a blocked run or a passed acceptance gate.

The same saved-assessment path and `review-interview-calibration.ts` commands from the baseline report apply,
using `--model learner-evaluation-9` and `--fixture policy-9-fresh-1` as appropriate. Preserve original baseline
files and use separate output paths. Failed, incomplete or budget-blocked cases do not count as agreement.

## Promotion gates

No CURRENT change until semantic results improve without regressions, fresh-case labels are reviewed, critical
decisions are repeated within approved budgets, and integrated learner/voice/workspace checks pass on the final
revision. This task has not validated a new voice path; the model result is normalized to the existing feedback
shape. Before any learner rollout, verify feedback remains after End and the audio/transcript/assessment link
with the candidate tool. Leave grade-driven routing and generated follow-ups off.
