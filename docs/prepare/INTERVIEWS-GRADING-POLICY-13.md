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

## Observed provider results — HOLD

Tested `a2c73a1`, clean before execution, on 9 November 2026 UTC using the normal restricted-role ADMIN_TEST
path. Sixteen initial + four repeated calls used exactly the normal 20-call allowance; persisted Admin and
global counters both equal 20. No earlier additional allowance was reused, no quota counter was reset,
and no source/production limit changed. All twelve required question snapshots passed the pinned metadata check.

| Measure | Initial | Repeat |
| --- | ---: | ---: |
| Cases | 18 | 4 |
| Paid model invocations | 16 | 4 |
| Free deterministic controls | 2 | 0 |
| Usable grades (including free controls) | 14 | 3 |
| Accepted class | 13 | 2 |
| Preferred class | 11 | 2 |
| All declared checks pass | 10 | 2 |
| Invalid outputs | 4 | 1 |
| Expected review outcomes matched | 0 of 1 | 0 of 1 |
| Provider failures/timeouts | 0 | 0 |

Twelve of sixteen initial MODEL calls yielded usable grades; the other two completed results were free
controls. Four outputs failed internal semantic consistency, rather than optional feedback schema. This
removes one earlier source of failures, but does not establish grading reliability.

Initial passing checks: H1-09 (relevant incomplete proposal), RS-02 (empty slogan), P2-02 (instruction echo),
RS-03, H1-11, RS-05, RS-01, R1-01 and the two deterministic controls. Failures:

- R1-08, A1-05, RS-04, R1-02: `INVALID_OUTPUT_INCONSISTENT`; no fabricated grades.
- P2-07: class/reasoning improved, but optional feedback still contained forbidden wording. The repeat passed.
- P2-08: NO_SUBJECT → NOT_ANSWERED, instead of the required ungraded review, on both trials.
- A1-01: accepted alternative PARTIAL, but a forbidden ASR-related gap; preferred CORRECT not reached.
- P2-06: INCORRECT (inside its broad historical band, but not preferred PARTIAL) and omitted credit for the
  true composition concept. This would change adaptive routing; a broad acceptable band is not release clearance.

Four repeats verified fresh IDs, `reused: false`, identical answer text and matching answer, question,
config and input-key hashes. H1-09 and P2-07 passed; R1-08 again failed consistency and P2-08 again returned
NOT_ANSWERED. Three stable usable class labels are not three successful cases; P2-08's stable label is wrong.

Shape-only SDK observations explain one consistency failure: R1-08 returned FALSE_CORE, correct `[]`,
incorrect `[1,2]`, reasoning `[2]`. The semantic contract requires reasoning to cite TRUE reasoning and therefore
be among correct evidence. The primary decision appears appropriate, but its reasoning field conflicts, so
the current validator rejects the result. This observation supports reviewing the separation of valid/invalid
reasoning and primary knowledge decisions; it does not justify silently weakening the frozen policy-13 guard.

An exploratory offline comparison applies the same eighteen case expectations to saved policy-12 results:
12 usable (including the same two free controls), eight accepted/preferred classes, seven cases passing all
checks. Policy 13 has fourteen usable, thirteen accepted, eleven preferred and ten fully passing. This is
same-input regression evidence, not unseen calibration or proof that the compact design caused the difference;
no new baseline model call was made. The full 65-case set has not been rerun for policy 13.

Private evidence under `/private/tmp/spasht-grading-validation/`: `policy-13-initial.json`,
`policy-13-initial-review.json`, `policy-13-repeat.json`, `policy-13-repeat-review.json`,
`policy-13-repeat-audit.json`, `policy-13-repeat-verification.json`, `policy-13-repeat-shapes.ndjson`,
`policy-13-budget-reconciliation.json`, and `policy-12-matched-subset-review.json`.
No rejected provider text, credentials or auth state was committed. The owned HTTP fixture server was stopped;
shared services were left alone. No real spoken candidate scenario was run or claimed for this preview.

**Release decision:** keep adaptive production release on hold, keep policy 8 current, and request critical
review of the actual contract/reference boundaries before another broad benchmark. The owner-authorized
AI-led adjudication removes the outside-review dependency, not the measured technical failures. The external
review brief is `INTERVIEWS-GRADING-EXTERNAL-REVIEW-BRIEF.md`.
