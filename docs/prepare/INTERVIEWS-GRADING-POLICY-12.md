# Forced-tool grading preview — 8 November 2026

Policy 12 is a preview only. Current learner policy remains 8. No merge, deployment or adaptive enablement.
Owner accepts AI-led technical adjudication; it is not independent human validation. Policy 11's real-model
failures remain recorded in `INTERVIEWS-GRADING-POLICY-11.md`.

## Why this candidate exists

Policy 11 produced malformed fields on eight initial cases and contradictory coverage/gaps on two others.
This candidate uses the same model, semantic criteria, exact-evidence validation and ambiguity disposition.
It requests one named `grade_interview_answer` data tool instead of free-form JSON. No tool action executes,
no result is sent back, and there is no automatic model retry or second grading call. The response still
passes the strict schema and subject-consistency guards; tool calling is not an accuracy guarantee.

AWS lists client-side tool calling as supported for Nova 2 Lite but native structured outputs as unsupported:
[model capabilities](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html).
[The Nova tool documentation](https://docs.aws.amazon.com/nova/latest/nova2-userguide/prompting-tools-function.html)
describes using a named tool and input schema for structured responses. This is that supported transport,
not native constrained JSON-schema generation or a change of model.

## Frozen configuration and acceptance

- Prompt 14 SHA256: `0a94fdba6ce1d119151c859ea3d93f41c3adce7cce491e7f92dbbaa2e175c96f`.
- Config canonical hash: `c7e0c6c598ce93aad3c157e32b7d416d76221e8a91e5e619c176aaf05ab5e981`.
- Tool schema canonical hash: `aa6c68551a91d14d0239d55386dec4632fb8de5b8bf1d9f7cb90502194a0b894`.
- Original policy configurations and prompt hashes remain pinned; only policy 12 sets `responseFormat: tool`.
- Reject missing/wrong/multiple tool submissions, nonobject input, unexpected termination, invalid fields,
  unsupported evidence and contradictory findings. Preserve usage and content-free failure reasons.
- Validated uncertainty remains ungraded, nonretryable and excluded from score-driven selection.

`policy-12-ai-review-1` freezes 65 distinct answers across reviewed, formerly heldout, pilot, reasoning,
ASR, fresh-policy-9 and readiness sets. Source-case provenance is retained and checks are merged without
relaxing labels. These are now regression inputs, not an unseen validation set. The only new disposition
is the already documented P2-08 review requirement; historical fixtures and reports stay unchanged.
`policy-12-repeat-1` selects six critical inputs for fresh, independently accounted invocations. Preserve
initial evidence before replacing only fictional Admin snapshots; verify input/config hashes and usage.
Repeated errors are never counted as stable grades.

Promotion requires all declared safety/semantic checks, intended review outcome, accurate grade/routing
labels and repeated usable outcomes. Any failed case remains a blocker to score-driven adaptation.
Broader domain coverage and real integrated voice/workspace checks remain separate release work.

## Verification before real-provider testing

- Focused evaluator tests: 82 passed, including transport schema/name, review outcome, invalid envelopes,
  invented evidence, contradiction, usage retention and old-policy request compatibility.
- Full server: 664 passed, 290 optional/database tests skipped. Initial sandbox listener denial was rerun
  with local listeners allowed; the successful run is the reported result. Server build passed.
- Actual SDK HTTP against the owned local simulation: nine assertions passed, including old-policy behavior,
  new valid tool input, review-required, wrong/duplicate tool envelope and throttling. This is fixture-only
  transport evidence, not a real-provider grading result.
- At the candidate freeze, no policy-12 provider call or real spoken test had run. The normal 8 November
  UTC allowance was exhausted by twenty policy-11 calls. The owner subsequently approved up to 75 additional
  local calls. Observed results and the reconciled allowance are recorded below.

Repeatable no-provider HTTP command is in the policy-11 document; the launcher now includes policy 12.
Private evidence: `/private/tmp/spasht-grading-validation/policy-12-focused.log`, `policy-12-server-tests.log`,
`policy-12-http-results.json` and `policy-12-simulation.ndjson`. No credentials, auth state or recordings
belong in Git. Production and shared voice services were untouched.


## Observed real-provider acceptance — HOLD

Application revision: `cdff9ff915b487f0b7a637dc2e366aa0caa8e2de`, clean at the run. Provider calls ran on
8 November 2026 UTC; final counter reconciliation occurred on 9 November after UTC rollover. This used
saved typed ADMIN_TEST answers against real Nova 2 Lite, not a voice simulation or seeded grades.
No learner policy promotion, merge, deployment or production-data change occurred.

All 31 pinned local reference questions were present, active and approved at their reviewed revisions.
Thirteen missing questions were copied from the local source bank into the isolated benchmark DB only;
the source bank was not modified. Runtime role `walkthrough_app` has neither superuser nor RLS bypass.

| Measure | Initial frozen set | Six fresh repeats |
| --- | ---: | ---: |
| Cases | 65 | 6 |
| Real model invocations | 59 | 6 |
| Deterministic free controls | 6 | 0 |
| Usable grades, including free controls | 28 | 4 |
| Classification inside accepted labels | 24 | 4 |
| Preferred classification matches | 23 | 4 |
| All declared checks pass | 23 | 3 |
| Invalid outputs | 37 | 2 |
| Required ungraded review outcomes | 0 of 1 | 0 of 1 |
| Provider errors/timeouts | 0 | 0 |

The initial 28 usable grades include six free deterministic controls: only **22 of 59 model-evaluated
answers produced a usable grade**. Four usable grades were outside their accepted classification;
one further case matched its class but failed the required reasoning-credit check. Do not report a
24/28 agreement ratio as overall reliability: it excludes the invalid outputs and includes free controls.

Initial invalid-output reasons: guidance missing/wrong type 14; uncertainty missing/wrong type 7;
unsupported evidence 4; contradictory COMPLETE coverage with gaps 3; depth finding missing/wrong type 3;
too many depth quotations 2; one each of COMPLETE without a correct central claim, empty claim quotation,
EMPTY with coverage, and too many claims. The parser kept rejecting these; no grade was fabricated.

### Semantic failures reviewed

- **R1-08:** INCORRECT expected, PARTIAL returned. The tautology “Browser is the browser” received
  substantive credit beside false context/page isolation claims.
- **H1-09:** PARTIAL expected, INCORRECT returned. A relevant translation suggestion was called false
  because it omitted evaluation methodology. Omitted essentials do not make that suggestion a false belief.
- **RS-02:** NOT_ANSWERED expected, INCORRECT returned. An empty “it is better” explanation was treated
  as an incorrect technical proposition instead of an unsubstantiated response.
- **P2-02:** NOT_ANSWERED expected, PARTIAL returned. An instruction echo received credit as subject knowledge.
- **P2-07:** PARTIAL class matched, but the stated competing-manual-order mechanism received no reasoning
  credit. This persisted on the repeat. The reference was not changed to accommodate it.
- **P2-08:** expected ungraded review failed on both calls with missing depth fields, not a valid uncertainty
  outcome. Invalid output is not counted as a successful safe review.

### Repeats and shape diagnosis

RS-03, H1-11 and A1-01 returned correct grades on both trials and passed declared checks. P2-07 returned
PARTIAL on both but still missed reasoning credit. P2-08 and A1-05 failed on both. Thus four stable usable
grade labels and only three consistently passing cases; two repeated failures are never stable grades.

All six repeats had new assessment IDs, `reused: false`, identical answer text and matching answer,
question, config and input-key hashes. Original reports/audit hashes were saved before the normal owned
delete/resubmit flow replaced only these fictional Admin snapshots. Persisted usage was retained.

Shape-only instrumentation on the repeat requests confirmed an empty depth object for P2-08 and an
omitted guidance field for A1-05. It forwarded the original SDK requests/responses without modification;
it saved types, lengths, hashes and quotation-match booleans, not rejected provider text. Named tool calling
did not enforce the required input schema reliably. These format defects coexist with semantic errors;
fixing the container alone would not qualify the evaluator for adaptive decisions.

### Allowance and evidence

59 initial + six repeated invocations = **65 additional calls out of 75 approved**. Persisted 8 November
Admin and global counters both moved from 20 to 85. No counter reset, new identity or earlier allowance
was used. The restricted process alone used a temporary Admin ceiling of 95; global 100 and all source /
production limits stayed unchanged. That process exited. Ten approved calls were not spent; the private
launcher refuses another UTC day. No production model or voice call was made.

Private evidence under `/private/tmp/spasht-grading-validation/`:

- `policy-12-initial.json`, `policy-12-initial-review.json` and initial log.
- `policy-12-repeat.json`, `policy-12-repeat-review.json`, `policy-12-repeat-audit.json`,
  `policy-12-repeat-verification.json` and `policy-12-repeat-shapes.ndjson`.
- `policy-12-budget-reconciliation.json` (explicitly the 8 November budget day), and postflight log.

The evidence directory is private and outside Git. No authentication state, credentials, audio or
rejected provider bodies were committed. No shared service was stopped or restarted for this benchmark.

## Next engineering decision

Reject policy 12 for promotion. Leave policy 8 and adaptive selection unchanged. AI-led label adjudication
is accepted and is no longer an external dependency; the remaining blocker is measured evaluator behavior.

Do not add another prompt appendix and treat that as a fix. Prepare a smaller assessment contract with
explicitly separate no-subject-answer, false-claim, incomplete-knowledge and uncertain-transcript outcomes;
separate optional learner prose from the grade-bearing evidence. Preserve the original transcript and
validate all cited source passages. Any such redesign requires a new preview/version and the same frozen
semantic checks, including the four wrong grades, implicit reasoning and actual-wrong ASR control. Do not
relax those checks or silently normalize contradictory judgments. Measure focused behavior before another
full benchmark, then require wider acceptance plus integrated real-voice/workspace checks before rollout.
