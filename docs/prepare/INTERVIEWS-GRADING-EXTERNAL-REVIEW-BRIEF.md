# Interview grading and adaptive-question review brief

Prepared 9 November 2026. Please evaluate the approach critically before recommending another model or
another prompt. This is an engineering review request, not a claim that the grader is calibrated.

## Product goal and release status

SpashtAI should choose a suitable next Interview question from a reviewed question bank based on the
learner's demonstrated understanding. Existing proposed action mapping is CORRECT → DEEPEN, PARTIAL →
CLARIFY, INCORRECT → SIMPLIFY, NOT_ANSWERED → SWITCH_TOPIC. This makes classification errors material:
a wrong grade can send the learner down the wrong learning path. Requests to repeat/skip and genuinely
uncertain transcripts must not be treated as demonstrated lack of knowledge.

Adaptive question selection is not approved for production. The current learner grading policy remains
`learner-evaluation-8`; experimental policies 9–13 have not replaced it. Main and EC2 were not changed by
this work. Expected grades are bank-relative AI-led technical judgments accepted by the owner; they are
not independently human-validated. Known ambiguous references and routing disagreements remain limitations.

## Model and evaluation boundary

- Amazon Bedrock **Amazon Nova 2 Lite**, model ID `us.amazon.nova-2-lite-v1:0`, region `us-east-1`.
- Temperature 0, output limit 2,000 tokens, 20-second request timeout, SDK maxAttempts 1. Temperature 0
  does not guarantee identical semantic decisions across invocations. No fine-tuning/training is involved.
- Question, versioned bank guidance and the saved answer/transcript are supplied as untrusted data.
  Expected test labels are NOT sent to the model. Fluency, accent and confidence must not affect knowledge grades.
- Each grading run pins a versioned configuration. Old configurations/prompts remain frozen. Explicit whole-answer
  abstentions and request-only responses can be handled deterministically without a model call; substantive
  technical attempts go to the model. Free controls are reported separately from real-model performance.
- Accepted results have exact evidence checks and internal consistency validation. Invalid responses preserve
  the answer, consume recorded usage and produce no fabricated grade. A validated REVIEW outcome also publishes
  no grade and must not steer adaptation. Feedback remains hidden during active practice until the existing End boundary.

## Earlier designs and observed failures

**Direct structured result (current policy 8 and earlier previews).** The model supplied overall class,
accuracy/reasoning/depth findings, quotations, strengths, gaps, misconceptions and guidance. Validators checked
shape, evidence and consistency. Concise correct answers and valid alternatives sometimes lost credit; missing
explanations were confused with false explanations, and transcription artifacts were treated as subject errors.

**Claim ledger (policies 9–10).** The model supplied individual claims, true/false/empty judgments, central/
secondary scope, reasoning and coverage. The server derived the overall class to prevent contradictory labels.
This helped some regressions but did not establish semantic correctness. Models returned COMPLETE while also
listing essential gaps, called substantive fragments empty, missed implicit reasoning, and changed labels on
an exact repeat. Policy 10's focused 17-case run matched classes on that sample, but repeated critical inputs
were not stable; it was not a passing broad calibration.

**Interpretation-aware ledger (policy 11).** Added literal vs normalized vs uncertain interpretation, retaining
original transcript evidence. Genuinely unclear speech should trigger ungraded review rather than an inferred
knowledge gap. This expanded an already demanding output contract. Of 19 initial cases (17 model + two free),
only nine yielded usable grades; required fields were malformed/missing and the expected review case failed.

**Forced named tool (policy 12).** Same model; changed response transport to a named data tool with an input
schema. Nothing executes and there is no recursive tool/model call. AWS lists tool calling as supported but
native structured outputs as unsupported for this model. The real provider still omitted required fields;
tool calling did not enforce schema conformance. Across 65 cases (59 model + six free), only 28 usable grades
were published: 22/59 model calls produced usable grades. Four usable grades were outside accepted labels;
another missed required reasoning credit. The expected ambiguous-answer review failed. Six fresh critical
repeats gave four stable usable labels, but only three consistently passing cases. Total additional calls: 65.

Concrete semantic errors persisted independently of formatting:

1. A tautology such as “a browser is a browser” earned substantive credit alongside false context/page claims.
2. A relevant translation suggestion was marked false because it omitted evaluation methodology.
3. “Use this tool because it is better” was treated as a false technical claim rather than no substantive answer.
4. Repeating rubric instructions (“give the concrete case and consequence”) earned technical credit.
5. A stated contrast/mechanism across ASR fragments received no reasoning credit because it lacked a polished explanation.
6. A fragmented attempted technical answer was treated as empty/incorrect instead of uncertain; an obvious misheard
   technical name could still be penalized. Conversely, real false statements must not be excused as transcription.

Known bank guidance defects and optional-depth wording can also encourage over-demanding grading. The reference
review checks this against questionText/primary documentation, but it does not prove all bank rubrics are correct.
No evidence supports attributing every failure solely to model size, token limits, ASR, or provider availability.

## Current compact preview (policy 13)

Code checkpoint `a2c73a1` on `codex/interview-grading-policy-13`. A standalone prompt and schema replace the rich
ledger. Required fields are `decision`, `correct`, `incorrect`, `reasoning`. Evidence arrays contain integer IDs
of server-numbered original transcript passages. The full transcript is also supplied; segmentation is not
semantic analysis. The server copies cited passages, so the model cannot invent or rewrite evidence quotations.

Five decisions distinguish the problematic boundaries:

- COMPLETE: meaningful correct essentials, no false-claim evidence → CORRECT.
- INCOMPLETE: meaningful true relevant understanding with missing essentials or mixed claims → PARTIAL.
- FALSE_CORE: explicit core false belief, not rescued by incidental true detail → INCORRECT.
- NO_SUBJECT: no attempted technical proposition, e.g. empty slogan/instruction echo → NOT_ANSWERED.
- REVIEW: intended technical relationships cannot be resolved reliably; nonempty reason, no grade.

References must exist, be unique per list, and satisfy decision consistency. Valid reasoning IDs must also be
in correct. A passage may legitimately contain both true and false claims. Optional depth is not assessed.
Optional feedback is independently validated; missing/malformed prose cannot change the core decision. The
server provides source quotations and default feedback when needed. Valid-looking but inaccurate feedback is
still a failure under the frozen acceptance checks; simplifying the schema does not relax those checks.

This removes one avoidable source of invalid grades. It does NOT establish that a cited passage supports the
model's meaning, that the semantic decision is true, or that optional feedback is correct. Those remain measured
acceptance requirements. No confidence score or unsupported accuracy claim is being added.

## Latest measured state

At the code checkpoint: 683 server tests passed, 290 optional/database tests skipped; server build and 101
focused tests passed. Thirteen actual SDK HTTP checks against an authored local stand-in passed. These checks
establish code/transport behavior, not model accuracy or a spoken conversation pass.

First policy-13 real-model round: 18 existing regression cases, 16 model calls + two free controls. Fourteen
usable grades (12/16 model calls), 13 classes inside accepted bands, 11 preferred matches, four internally
inconsistent outputs. Eight cases failed one or more declared checks. The expected review outcome failed.
Empty-slogan, instruction-echo and omitted-detail-versus-false cases improved. Problems remained with an ASR
answer, mixed-answer credit, ambiguous speech and optional feedback wording. This is still HOLD. It is a focused
regression set, not unseen data or a comparable full 65-case policy-12 rerun. Four fresh repeats gave two passing cases: the inconsistent false-core case failed again and the ambiguous
answer again returned NOT_ANSWERED. Fresh IDs and identical input/config hashes were verified. The normal
20-call allowance was fully used, with no cap increase. Do not infer a broad accuracy improvement from differently selected sets.

One diagnosed conflict is particularly relevant: a response correctly chose FALSE_CORE and cited incorrect
passages `[1,2]`, with no correct passages, but also called passage `[2]` valid reasoning. Our guard rejects it
because valid reasoning must refer to true understanding. Should primary knowledge judgment remain usable with
reasoning explicitly NOT_MET/unassessed, or should the entire result remain withheld? Any change must be a new
version and tested, not a silent repair to historical results.

An exploratory same-input comparison of saved policy-12 results on these eighteen cases gives twelve usable
grades and seven fully passing cases, versus fourteen usable and ten fully passing for policy 13. Both include
the same two free controls. This is limited regression evidence, not a new baseline run, causal proof or release
acceptance. No full 65-case policy-13 benchmark or integrated spoken test has passed.

## Questions for the reviewing AI

1. Is the compact contract the appropriate next experiment, or should assessment be staged differently?
   Explain which observed failure a proposed change addresses and what it cannot solve.
2. Which semantic boundaries or reference labels need further adjudication, especially mixed answers,
   instruction echoes, implicit reasoning, uncertainty and ASR? Avoid reclassifying failed outputs just to pass.
3. Should core-claim truth and reasoning be assessed separately? What bounded additional cost/latency and
   repeatability evidence would justify a second assessor or another model? Do not assume agreement equals truth.
4. How should incomplete evidence and uncertain meaning influence next-question selection without inferring
   a knowledge deficit? Should some outcomes explicitly retain the topic or ask for clarification?
5. Propose predeclared release gates, broader domain/ASR coverage and repeat tests. Include grade availability,
   false-positive credit, false-negative penalties, correct ungraded outcomes and adaptive routing stability.
6. Recommend model comparison only with a frozen same-input benchmark, measured cost/latency and consistent
   validators. No production switch, fine-tuning, or weakened checks should be presumed authorized.

Relevant repository files: `apps/server/src/interviews/evaluator/contracts.ts`, `model.ts`, `service.ts`;
`apps/server/scripts/calibrate-interview-evaluator.ts`, `review-interview-calibration.ts`;
`apps/server/test/fixtures/interview-calibration-policy-13-focused-1.json` and `policy-13-repeat-1.json`;
`docs/prepare/INTERVIEWS-GRADING-POLICY-10-RESULTS.md`, `INTERVIEWS-GRADING-POLICY-11.md`,
`INTERVIEWS-GRADING-POLICY-12.md`, `INTERVIEWS-GRADING-POLICY-13.md`,
`INTERVIEWS-AI-ADJUDICATION-2026-11-08.md`.

No credentials, authentication state, real learner identifiers or private recordings are included here.
