# Grading-boundary adjudication — 10 November 2026

**Two future acceptance labels resolved; adaptive release remains HOLD.** This is owner-authorized AI
technical adjudication, not independent expert calibration. No model call, runtime/prompt/parser change,
active-policy change, bank write, merge or deployment occurred. Today's approved 12-call allowance was already
used; unused normal daily quota does not authorize additional calls.

## The distinction to enforce

| Answer state | Knowledge disposition | Shadow action / knowledge update |
| --- | --- | --- |
| Meaning clear; requested essentials covered | CORRECT | DEEPEN; record only supported understanding |
| Meaning clear; substantive relevant knowledge but an essential missing | PARTIAL | CLARIFY; missing essential remains missing |
| Meaning clear; explicit false core with no meaningful correct core | INCORRECT | SIMPLIFY; do not invent partial credit |
| No subject proposition: instruction echo, empty slogan | NOT_ANSWERED | CLARIFY_RESPONSE; no knowledge update |
| Technical meaning cannot be resolved without inventing relationships | Ungraded review | HOLD; no knowledge update |
| Whole-answer explicit abstention / learner control | Existing control handling | No inferred knowledge update |
| Capture integrity incomplete/unknown, provider error or invalid output | Unavailable assessment | HOLD; never convert to ignorance |

These definitions do not supply an automatic semantic oracle. The parser can enforce a declared review and
exact source evidence; it cannot prove the model's CLEAR interpretation is correct. No pronoun/ellipsis/keyword
filter, answer-ID runtime exception or blanket promotion was added. An admission of missing knowledge inside
an otherwise substantive answer must not be discarded as whole-answer abstention.

## Decision 1: C1-04 becomes PARTIAL in a future fixture

The learner describes measured events at a defined grain and descriptive attributes used for filtering/grouping,
then explicitly cannot assign the fact/dimension names. Both described roles are meaningful subject knowledge;
the missing assignment is a coverage gap. The transcript meaning itself is understandable. The measured
PARTIAL result acknowledged precisely that gap rather than claiming a correct named mapping.

[Microsoft's dimensional-modeling guidance](https://learn.microsoft.com/en-us/power-bi/guidance/star-schema)
supports the two domain roles. It does not define interview grading labels. The PARTIAL judgment is our stated
question-scope/adjudication decision: retain the demonstrated concepts, require clarification of the missing
mapping, and never treat that mapping as mastered. The future expected grade is PARTIAL, not CORRECT and not
automatic ungraded review. Any future knowledge store must retain this missingness instead of treating a
whole-topic grade as proof of every essential.

This is an explicit correction to the diagnostic's expected label. It does **not** retrospectively turn the
completed diagnostic into a passing trial. The original C1-04, its UNASSESSED expectation and all old results
remain unchanged. New case B1-01 has the same answer, a new fixture/case ID, the old expectation, source-file
hash and written rationale in its provenance.

## Decision 2: P2-07 becomes CORRECT in a future fixture

The reviewed question asks what determines keyboard focus order and why positive tabindex is discouraged.
The answer identifies DOM position and positive tabindex's competing manual order. This covers both requested
essentials under the existing reviewed guidance. Its inability to give an extra example is not a required
knowledge gap; its fragmented delivery is not a reason to reduce technical credit. Valid reasoning remains required.

The [HTML focus specification](https://html.spec.whatwg.org/multipage/interaction.html#the-tabindex-attribute)
describes tree ordering and the separate priority ordering caused by positive tabindex. The specification
supports those facts, not a universal grading standard. The reviewed bank explicitly makes a separate example
optional and accepts a concise natural-versus-manual-order contrast. That question-relative boundary is why
B1-02 has one expected label, CORRECT, instead of inheriting P2-07's PARTIAL/CORRECT band with a preferred
PARTIAL. This is not permission to accept every short answer or omit requested causal understanding.

Original P2-07 stays frozen with its original preferred label. Its earlier reports continue to show the
historical disagreement. No saved old report is re-versioned or re-IDed for scoring against the new labels.

## Unchanged boundaries

- N15-03 still requires ungraded review. Its unresolved fragments do not establish a technical relationship;
  this is not the same as a clear statement that identifies some concepts but admits a missing essential.
- P2-02 still expects NOT_ANSWERED. An empty causal fragment and instruction echo contain no substantive
  technical proposition. Repeated unnecessary review remains an observed model failure under that expectation.
- Clear reversed roles remain INCORRECT. True incidental vocabulary alone must not rescue a false core.
- The historical unsafe N15-03 CORRECT result is retained. Two safe repetitions on unchanged inputs are not
  an implemented fix or sufficient reliability evidence.

The current policy-16 prompt already describes these distinctions. The new decision record does not justify
adding another overlapping instruction or claiming the model follows the rule reliably. The next model change,
if any, must address measured failure and be evaluated separately; no new model/prompt version was created here.

## New acceptance fixture, not new results

`apps/server/test/fixtures/interview-calibration-grading-boundaries-1.json` contains ten cases:

- B1-01/B1-02: the two explicitly adjudicated historical answers, with source version/file hashes and old labels.
- B1-03/B1-04: the unchanged ambiguous/no-answer boundaries, versioned with original answer provenance.
- B1-05–B1-10: six new controls covering clear partial fact-table knowledge, unresolved fragments, pure
  instruction echo, reversed roles, complete focus-order reasoning and partial focus-order knowledge.

The three relevant existing question revisions/guidance hashes are retained. Expected labels are acceptance
data only; they are not sent to the model by the normal calibrator and are not runtime answer overrides.
No model has been tested on this new fixture. It is not added as a fictitious passing dataset in the replay.
A further fresh run requires its own bounded allowance and available normal quota; none was requested or used
by this offline checkpoint.

Offline tests pin historical source files/answers, enforce new acceptance distinctions with explicitly synthetic
output rows, reject rescore of old saved reports via fixture-version mismatch, and check that substantive
partial answers with admissions are not swallowed by deterministic abstention. They test the acceptance
checker and deterministic control boundary, **not the model's ability to understand arbitrary speech**.
`npm run grading:check` continues replaying the same historical 32 measured/saved rows and still returns HOLD.
Its compact summary separately identifies the ten future cases as `modelTested: false`.

## Remaining work

The test oracle now has explicit future decisions for the two disputed labels. Model reliability remains the
blocker: unsafe credit varied across identical historical inputs, and instruction echo still receives unnecessary
review. Preserve those observations, measure any proposed change against the clarified boundaries plus broader
regressions, and complete real automated voice/workspace acceptance before adaptive enablement. No new paid
comparison or deployment is authorized by this decision record.

## Validation observed

207 focused regression tests plus six network-guard tests passed. Strict TypeScript checking of the new boundary
tests and the diagnostic planner passed. The default compact summary reports ten future cases with
`modelTested: false` alongside the same 32 historical rows and their HOLD outcomes. The historical fixture
hashes still match; no saved results were adapted to the new labels. There were zero further model calls
and no database writes. Source scoring/voice code was not changed, so no live voice pass is claimed.

The retained-result replay is a historical audit, not a fresh release certification. A future candidate must
supply its own new validation evidence; it must not make old failed snapshots pass by rewriting their labels.
Old reports retain their recorded HOLD outcomes even if a later candidate eventually fixes the defects.
The current adaptive feature remains held because no such candidate has yet demonstrated that reliability.
