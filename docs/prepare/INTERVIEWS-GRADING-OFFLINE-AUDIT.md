# Offline semantic audit and reusable checks — 9 November 2026

**Adaptive release remains HOLD.** This checkpoint adds tooling and a diagnostic fixture, not an active
scoring change. No provider calls, budget changes, database writes, voice tests, merge or deploy.
Active learner policy remains 8. The existing paid allowance is exhausted at day usage 100; no reset,
new identity, raised global cap or extra paid invocation is authorized by this tooling work.

## What the saved evidence establishes

The prior scoped-bank trial used application `524d4c936fce1cf2d384916332b6da85e615a957`, inactive
`learner-evaluation-16`, Nova 2 Lite LOW, and the pinned `grading-scope-1` bank. The full findings remain
in `INTERVIEWS-QUESTION-SCOPE-VALIDATION.md`; they have not been relabelled. This audit uses an allowlisted
projection of all 20 initial validated results and the unchanged frozen expectations. The projection contains
18 model results and two reused deterministic controls, not the two fresh repeats or raw provider output.

Three disagreements remain distinct:

| Case | Saved outcome | Required behavior / unresolved boundary |
| --- | --- | --- |
| N15-03 | CORRECT; interpretation declared CLEAR | Ungraded review: fact/dimension referents cannot be resolved without inventing relationships |
| P2-02 | EVALUATION_REVIEW_REQUIRED | NOT_ANSWERED for instruction echo/empty slogan; this is an unnecessary review, not a wrong knowledge grade |
| P2-07 | CORRECT, inside the original PARTIAL/CORRECT accepted band | Preferred PARTIAL differs; accepted band is not a unique adaptive-action oracle |

The replay retains the concise-correct, meaningful-mixed and incidental-true/false-core controls. Tests pass
by checking that the reviewer exposes both successes and failures accurately. **The model trial stays held.**

## Root cause boundary

N15-03 actually said:

> The table with the... event thing. The other has that one, the measure... no, the label. I mean the one we said, not the other.

The saved result credited a correct fact/dimension distinction even though the learner did not assign either
name to either role. Its exact evidence includes fragments such as “The table with the...” and “event thing.”
The server's `answerPassages()` splits at punctuation, including ellipses. Such fragments provide literal
provenance, not proof of a technical proposition. `userMessage()` supplies **the full answer as well as these
passages**; there is no evidence that splitting removed the full answer from the model input. Passage grouping
might affect interpretation, but this run does not establish it as the causal failure. Do not replace it and
claim the semantic defect fixed without a controlled comparison.

The demonstrated failure is over-inference: recognizing related vocabulary was treated as understanding the
relationship. The parser can reject invalid source IDs, unsupported quotations and a declared UNCERTAIN
interpretation. It cannot reliably discover that a model's CLEAR interpretation is false. The current prompt
already forbids guessing; adding another copy of that sentence is not an evidenced remedy. Earlier policies
9 and 11/12 already tried detailed claim/interpretation ledgers, with their own consistency/format failures.
A new ledger is not a novel guaranteed fix. A second model from AWS would also be a correlated fallible
judge, not independent expert validation.

Do not introduce a runtime answer-ID exception, a keyword/pronoun/ellipsis rejection rule, blanket mixed-answer
PARTIAL credit, or relaxed expected labels. Clear short answers, resolved pronouns and harmless ASR substitutions
must remain gradable. A semantic model defect cannot honestly be called fixed by an offline fixture replay.

## Narrow next experiment (prepared, not run)

`apps/server/test/fixtures/interview-calibration-ambiguity-contrasts-1.json` adds six new, AI-adjudicated
contrasts on the same pinned fact/dimension question. They are diagnostic inputs, not independent validation
or model results:

1. Explicit correct role mapping.
2. Correct mapping with resolved pronouns.
3. Correct mapping with ellipses.
4. Both technical roles mentioned but their fact/dimension assignment explicitly unresolved.
5. The same roles explicitly reversed (a clear false belief).
6. Contextually recoverable technical-name transcription substitution.

This isolates relationship understanding from punctuation, word overlap and technical-name normalization.
Keep existing failures as regression cases and preserve all initial results. With a new approved allowance,
first measure unchanged policy 16 on these contrasts and repeat the original N15-03/control cases. If a later
candidate changes passage grouping or another single mechanism, run a bounded matched comparison against
that baseline using identical answer/question/configuration pins except the declared change. Report format
availability, unnecessary review, unsafe credit and repeat stability separately; do not choose a patch based
only on improving one remembered answer. Use AWS models only. Nothing here authorizes those paid runs.

If ambiguity cannot be reliably distinguished, leave grade-driven selection disabled; do not convert review
or provider errors into incorrect answers. Normal, nonadaptive Interviews can retain their existing path.

## Simple local workflow

Run `npm run grading:check` from the repository root. It reuses focused mocked evaluator tests and the existing
offline acceptance reviewer. No app, Docker, AWS credentials, database, provider call or chat agent is needed.
Full instructions, exit codes and the code-only option are in `tools/interview-grading/README.md`.

The default replay deliberately returns HOLD (exit 2). A passing code-only run is not release approval.
`tools/interview-grading/runs/<timestamp>/summary.json` is the compact ignored evidence entry point for both
owner and future agents. Read that first; expand detailed logs only when needed. Saved evidence never proves
a fresh model change correct, and this workflow does not substitute for real automated voice acceptance.

## Observed local validation

The convenience command completed with **192 focused regression tests passed** plus **six network-guard
checks passed**. It reviewed all 20 saved initial rows, retained both failed cases and the separate preferred-label
disagreement, and exited **2 / HOLD** as intended. The code-only mode also passed (191 tests before adding the
final fixture-hash pin test). The default run after that addition passed 192. The tested dirty state was recorded
honestly in its summary. All 20 result projections were compared field-for-field against retained originals.

Missing-dependency smoke in a disposable temporary directory returned exit 1 with a clear setup message and
saved ERROR summary; no download was attempted. Help and unknown-argument handling were checked. Output
was verified ignored by Git. New contrast cases were checked for unique IDs, existing question pins and
nonempty answers; no semantic/model success is implied by those structural checks. No full application or
spoken tests were necessary or claimed for this offline-only addition.
