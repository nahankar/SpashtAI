# Compact assessment preview — 9 November 2026

Preview only; policy 8 remains the current learner policy. No production adaptive enablement or deployment.
The owner accepts AI-led expected-grade adjudication, not independent human validation.

## Root cause and bounded redesign

Policy 12 demonstrated two independent defects: malformed nonessential output fields blocked usable grade
publication, while well-formed outputs still confused false beliefs, missing detail and empty slogans.
Forcing one named tool did not enforce the model's JSON input schema. The benchmark remains HOLD.

Policy 13 uses the same Nova 2 Lite model and a standalone prompt, not another appendix to the earlier
claim ledger. Four required fields carry the assessment: `decision`, `correct`, `incorrect`, `reasoning`.
IDs refer to deterministic server-copied passages from the saved transcript; the model cannot supply a new
quotation. The full transcript remains visible and boundaries do not establish meaning or truth.

- COMPLETE maps to CORRECT, requires correct evidence and no false-claim evidence.
- INCOMPLETE maps to PARTIAL and requires meaningful correct evidence.
- FALSE_CORE maps to INCORRECT and requires evidence of a false core claim; true incidental detail may coexist.
- NO_SUBJECT maps to NOT_ANSWERED with all evidence lists empty. It is not a false knowledge judgment.
- REVIEW requires empty evidence lists and a bounded nonempty reviewReason, and publishes no grade.

Reasoning references must also be among correct references. Every reference must exist and be unique in its
list. The server supplies the criterion findings, quoted source passages and default feedback. Optional depth
is deliberately not assessed. Semantic truth and whether a fact is core remain model judgments, not proven
by these structural checks. A passage may contain both true and false statements, so IDs can appear in both
correct and incorrect lists; this is not automatic proof of a contradiction.

Optional feedback is independently schema-checked. Omitted/malformed prose is discarded with a server note;
it cannot repair, downgrade or upgrade the core grade. Feedback cannot introduce gaps/misconceptions for a
COMPLETE result or false-claim notes when no false evidence was supplied. Valid-looking but inaccurate prose
is still subject to the frozen acceptance checks; no fixture requirements are relaxed to get a passing score.

## Frozen configuration and first test round

Prompt 15: `2597d10aa198ce0300f7f770650832be8a2b14d45737f9c6f1404e9077a5f566`.
Config: `f8d1d35fe6f73fc18cf8170b10c7795bd9d541169dc3586c7be13554c0c81252`.
Tool schema: `c7ee5f6e9272c94688ed57f7a5dcf39c67d6a39fad8651a693463365b1f9961d`.

`policy-13-focused-1` retains 18 existing answers/labels: four wrong-grade cases from policy 12, the missed
reasoning case, ambiguous transcript, correct/wrong ASR controls, mixed/concise/false regressions and two free
controls. Sixteen provider calls, followed by four fresh accounted repeats in `policy-13-repeat-1`, fit the
normal 20-call daily limit. No earlier additional allowance is carried into another UTC day. This is a
focused regression sample, not fresh heldout evidence or full acceptance. Historical fixtures/results remain.

Before provider calls: 101 focused tests; full server 683 passed / 290 optional DB tests skipped; server
build passed. Actual SDK HTTP against the owned local fixture passed 13 scenarios, including the compact
valid assessment, malformed optional feedback with retained grade, review, wrong-tool rejection and old
policy behavior. Fixture transport evidence does not establish real-model grading accuracy.

Private evidence lives under `/private/tmp/spasht-grading-validation/`; no auth, credentials, audio or
rejected model bodies are committed. No voice stack was changed or stopped. Integrated real voice/workspace
validation and broader frozen grading acceptance remain prerequisites to a future learner/adaptive rollout.
