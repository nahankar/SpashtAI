# Isolated question-scope validation — 9 November 2026

**Completed the approved 20-call scoped-bank trial on `524d4c936fce1cf2d384916332b6da85e615a957`.
Adaptive release remains HOLD.** Preparation made no paid calls; the subsequently approved real-model
results are recorded below. No production changes, active scoring-policy changes or live voice tests. Active learner
policy is still 8. The test uses the unchanged, inactive `learner-evaluation-16` preview from the review-boundary
fix. The source prompts, old bank, old fixtures and prior results were not rewritten.

## What changed

Created nine question copies in namespace `grading-scope-1`, only in local database
`spasht_grading_validation` on 127.0.0.1:55443, using restricted `walkthrough_app` (no superuser/RLS bypass).
Four copies have reviewed question-scoped guidance; five are unchanged comparison controls. Every original
`automation-pilot` row remains intact, including revisions and approval flags. A separate namespace avoids
replacing the bank's current row and making historical revisions unavailable for a future baseline run.

All copies used the normal bank service: `createQuestion` -> `confirmProvenance` -> `approve_activate`.
The existing fictional Super Admin supplied the action identity; no role was changed or new quota identity
created. New drafts were unapproved/inactive at revision 1; provenance and approval/activation produced
eligible revision-2 copies. Verified audit records: nine creates, one provenance attestation, one bulk
approval/activation. Prior assessment records and paid quota counters were unchanged at setup. The later approved trial
added exactly 20 calls, as reconciled below. Two new deterministic
control snapshots were saved during verification; neither invoked a provider or used paid quota.

Four revised guidance definitions are committed in `calibration/question-scope-bank-1.json`, derived from
`calibration/question-scope-proposal-1.json`. Question text, track, difficulty and experience band are unchanged.
Required understanding, optional depth, illustrative answer and technical references were reviewed against
primary documentation. The guidance contains domain concepts, not rules that recognize benchmark answers.

| Question | Required scope kept | Extra requirements moved out of Core |
| --- | --- | --- |
| DE-NEW-001 fact/dimension | Measurement/event rows at grain versus descriptive context | Star-schema example and safe-aggregation explanation |
| AUT-NEW-005 stale elements | A valid stale-reference cause and sound fresh-lookup recovery | Page-object architecture, detailed wait policy, separate refutation of supplied misconceptions |
| DEV-NEW-016 CompletableFuture | All four requested API/handling areas | Executor design, cancellation and mandatory misconception refutation |
| WEB-NEW-099 keyboard order | Natural focus order and why competing positive tabindex order is discouraged | Extra tabindex variants, example layout and broader focus checklist |

Primary references checked: [Microsoft dimensional modeling](https://learn.microsoft.com/en-us/power-bi/guidance/star-schema),
[Selenium stale-reference documentation](https://www.selenium.dev/documentation/webdriver/troubleshooting/errors/),
[Java CompletableFuture](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CompletableFuture.html),
[HTML tabindex specification](https://html.spec.whatwg.org/multipage/interaction.html#the-tabindex-attribute).
These sources support domain facts. The grading expectations and scope boundaries are owner-authorized AI
technical adjudication, not independent human/domain-expert validation. No requirement was removed merely
because a tested answer omitted it: CompletableFuture still requires the four areas explicitly asked.

## Mixed-answer finding and safeguards

The existing parser cannot determine semantic relevance from a truth flag or a strength string. A true
incidental SQL/browser fact does not rescue a false answer about table roles or stale references. Conversely,
meaningful true cause/recovery or composition knowledge must not disappear because of an additional false
claim. Automatically turning every mixed true/false output into PARTIAL would produce false credit.
No blanket promotion, fabricated grade, question-ID runtime override or score-to-question routing was added.

The next test includes two newly authored incidental-true/false-core controls, S1-01 and S1-02. They contrast
with the meaningful mixed knowledge in P2-06 and N15-08. All 18 pre-existing cases retain their exact answers,
expected/accepted labels and semantic checks. P2-07's broader PARTIAL/CORRECT band and preferred PARTIAL are
preserved; its completeness boundary still requires explicit review before it can be a unique routing oracle.
A broad-band match is not automatically an adaptive pass.

## Runner safeguards and frozen fixtures

The calibration runner now accepts an explicit fixture `namespace`, defaulting to the original
`automation-pilot` for old fixtures. Scoped fixtures require both reviewed revision and SHA256 guidance hash.
The guidance hash includes namespace, QID, revision and every evaluator snapshot field except the generated
row ID; that exclusion permits identical content in another isolated database without a false mismatch.
The normal service still persists its full question snapshot/hash, including its row ID.

Every selected question is preflighted **before the first enqueue**, and checked again at submission. A
namespace mismatch, changed revision/content or inactive/unapproved question cannot silently fall back to
the old bank. Reports identify the bank namespace and pins. `--preflight` validates the selected bank/config
pins without an assessment/provider call. Its success is not authentication, provider-access, quota or
semantic-quality validation. Empty case selections are rejected instead of reported as a passing check.

Frozen fixtures:

- `apps/server/test/fixtures/interview-calibration-question-scope-focused-1.json`: 20 rows comprising
  18 model-evaluated cases and two free controls, explicit namespace and nine portable guidance hashes.
- `apps/server/test/fixtures/interview-calibration-question-scope-repeat-1.json`: two fresh repeats,
  N15-01 (concise correct distinction) and N15-08 (meaningful mixed stale-element knowledge).

The subsequently approved separate allowance of **20 paid calls maximum** covered 18 initial cases plus two repeats; the
canary is included. Two free controls may reuse their already saved deterministic results and must not
be represented as independent model replications. Paid trials and repeats must be fresh, with preserved
initial evidence and verified identical answer/question/config/input hashes for repeats. This allocation
does not repeat every case or establish general-domain reliability.

Use Amazon Bedrock Nova 2 Lite with the existing policy-16 config, LOW thinking, 15,000-token cap and
40-second timeout. No prompt/schema/model or resource expansion is proposed for this bank experiment.
The maximum configured generation allowance is 300,000 tokens; actual usage/latency must be reported.
Stop on unsupported configuration, access, prerequisites or token-limit failures; retries displace planned
cases within the same total. At preparation, paid day usage was 80. The owner then approved these 20 calls; usage is now 100,
the existing global limit. This allowance is exhausted and no extra calls are authorized.
Do not reset counters, change identity, or raise the production/global limit. Reconcile again if the day changes.

Provider inputs differ for the four revised questions; the other five are controls. Policy 16 also repairs
summary handling compared with the measured policy 15, while sending the same provider request for a given
bank input. Report formatting availability separately from semantic improvements. Do not attribute a generic
invalid-output-to-review change to better model judgment or count old failures as retroactive passes.

## Validation observed

- Restricted-role local bank workflow and audit records verified. All nine scoped revision/guidance pins
  match. Original bank rows, prior assessment IDs/configs/results/status and all budget rows match the
  retained before-state archive.
- Both no-provider preflights passed: 20 initial rows and two repeat rows.
- Actual normal runner/service path completed G-ABSTAIN and G-REQUEST in the scoped bank. SDK sends were
  explicitly disabled as a safeguard: **zero provider calls**, zero usage entries, unchanged quotas, both
  NOT_ANSWERED with the expected deterministic kind. These are functional controls, not model grading.
- Negative test changed a later selected question hash after a valid first selection: the run rejected
  changed guidance before the first enqueue, with no new assessments, provider call, quota change or
  partial result. Its temporary fixture was removed; evidence remains private.
- Focused helper/calibration/review tests: **53 passed**. Full serial server suite: **780 passed,
  290 optional/database tests skipped**. Strict calibration-script TypeScript check passed.
- All 18 historical case objects are identical to policy-15 fixtures, two new IDs are unique and two repeat
  objects exactly match their initial definitions. No paid model result is claimed for the scoped bank.

The first seed reached normal approval/activation but failed during final report hashing because the helper
passed whole database rows into a strict snapshot schema. That helper now projects the precise evaluator
snapshot fields before hashing. A read-only reconciliation verified the already-created rows; the bank was
not reseeded or overwritten. The failed report remains retained, and the corrected final verification passes.

No voice capture, agent, UI, active learner grading or production data path changed. Spoken tests were not
run or claimed. Actual automated voice/workspace validation and broader/fresh/repeated semantic validation
remain prerequisites for eventual adaptive release.

## Evidence and reproducibility

Private directory `/private/tmp/spasht-grading-validation/` is mode 700. Evidence includes:

- `scope-bank-baseline-archive.json`: original bank, budgets and prior assessment before-state (private).
- `scope-bank-seed.log`, `scope-bank-verified.log`, `scope-bank-created.json`, `scope-final-verification.json`:
  normal setup, corrected report, pins and final preservation/audit checks.
- `scope-fixture-preflight.log`, `question-scope-{focused,repeat}-1-preflight.json`.
- `scope-free-controls.json`, `scope-free-controls.log`, `scope-free-controls-verification.json`.
- `scope-negative-fixture.json`, `scope-negative-preflight-result.json`.
- `scope-bank-focused.log`, `scope-bank-server-serial.log`, `scope-calibrator-typecheck.log`.

Only test content, hashes, runner source, tests and documentation are committed. No credentials, auth state,
recordings, actor-specific archives or token-bearing logs are committed. Shared services were not stopped.
Production and the original local bank were not changed.

The already completed one-time bank setup used guarded private scripts `seed-scope-bank.mts` and
`verify-scope-bank.mts`, normal bank service functions and the committed data definition. Creating the bank
elsewhere requires the original pinned baseline inputs and the same authoring/review workflow; do not directly
set approval flags or overwrite a namespace that already exists. Final pins are portable because IDs are excluded.

Preflight command (ACTOR_ID is the existing local fictional admin, not a new quota identity):

```sh
env DATABASE_URL=postgresql://walkthrough_app@127.0.0.1:55443/spasht_grading_validation \
  node --import tsx apps/server/scripts/calibrate-interview-evaluator.ts ACTOR_ID /private/tmp/question-scope-preflight.json \
  --fixture question-scope-focused-1 --model learner-evaluation-16 --preflight
```

Use the repeat fixture name for repeat preflight. Without `--preflight`, the runner uses the normal
accounted Admin assessment path and may incur model charges; do not run it without the new bounded allowance.
The next real run must pin the committed application SHA, policy-16 config hash
`0f6f309aec2d53806612cac4180f1b4349b6dca98c4681fe1e6e5f93ebe0148a`, namespace and fixture hashes.
The preparation commands do not authorize spending, merge, deploy or adaptive enablement. The completed
real-model run below used a separate explicit owner approval and a revision/configuration/quota-guarded launcher.


## Completed scoped-bank trial

Tested a clean tree at **524d4c936fce1cf2d384916332b6da85e615a957**, policy 16/config hash above,
namespace `grading-scope-1`, with all nine approved/provenance-confirmed question revision/guidance pins
verified. Amazon Bedrock Nova 2 Lite only, us-east-1, LOW thinking, 15,000-token cap, 40-second timeout.
No source, bank guidance, prompt, expected labels, validation rules or bounds changed during the run.

The R1-08 canary is included in the 18 initial paid cases; 17 further initial cases and two fresh repeats
complete **20 actual paid invocations**. Two deterministic controls reused their existing correct scoped
results with no provider usage, explicitly not fresh model replications. No retries, provider/configuration/
access failures, invalid-output jobs, request timeouts or max-token failures occurred. Structurally usable
grades still do not establish that the represented meaning is true.

| Measure | Initial paid cases | Fresh repeats |
| --- | ---: | ---: |
| Cases / provider invocations | 18 | 2 |
| Structurally usable knowledge grades | 16 | 2 |
| Accepted knowledge grades | 15 | 2 |
| Preferred knowledge grade label | 14 | 2 |
| Expected uncertain cases correctly left ungraded | 1/2 | Not selected |
| All frozen semantic/evidence/feedback checks pass | 16/18 | 2/2 |
| All checks AND preferred grade/review outcome | 15/18 | 2/2 |
| Invalid-output jobs | 0 | 0 |
| Server-held core grades | 0 | 0 |
| Unexpected review on a gradable control | 1 | 0 |

Knowledge-grade counts exclude matched ungraded review. Sixteen initial cases expected a knowledge grade,
two expected review. P2-07 stays in its original PARTIAL/CORRECT accepted band but differs from preferred
PARTIAL; it is not silently counted as a unique adaptive-routing pass. The initial offline reviewer exits 1
for HOLD; the two-case repeat subset passes its sample checks, not the overall release.

### Improved cases and controls

- N15-01: the concise correct fact/dimension distinction is now CORRECT, with valid reasoning credited,
  and repeated as CORRECT. The previous trial marked it PARTIAL and demanded an unasked grain/aggregation
  explanation. Both new trials pass all frozen checks.
- P2-06: meaningful dependent-composition knowledge with a false synchronous-call recommendation is now
  PARTIAL, with the correct portion acknowledged and genuine missing requested areas retained as gaps.
  This was observed once, not selected for repetition.
- N15-08: meaningful correct stale-reference cause/recovery beside the false wait/reattachment claim is now
  PARTIAL and repeats as PARTIAL. Both pass; reasoning remains mixed rather than fully credited.
- S1-01 and S1-02: incidental true SQL/browser facts do not rescue explicitly false core beliefs. Both are
  INCORRECT with the expected misconception reporting. Each is one new trial, not a general guarantee.
- Other clear-wrong, empty-reason and recoverable-ASR controls pass. Both free deterministic controls pass.

### Remaining failures — release stays blocked

**N15-03, unresolved referents, was graded CORRECT.** Its actual answer says:
“The table with the... event thing. The other has that one, the measure... no, the label. I mean the one we
said, not the other.” It does not establish which table has which role. The result nevertheless credits
“the core distinction between fact tables (events/measurements) and dimension tables (descriptive
context/labels).” Its cited source fragments include “The table with the...”, “event thing.” and
“The other has that one, the measure...”. Those strings are exact; the missing relationship is not
established by exact string matching. The response declared CLEAR and had no hold metadata.

This is unsafe over-credit, not merely optional feedback wording. The offline shadow router would propose
DEEPEN and a knowledge update. The previous bank trial declared UNCERTAIN on this case; the new result
is a regression. Bank inputs changed and calls are sequential/nonrandomized, so this does not prove
which individual guidance edit caused it or exclude model variation. It does show that lower rubric
strictness plus valid source references is insufficient to establish dependable meaning.

**P2-02, instruction echo/empty justification, still yields EVALUATION_REVIEW_REQUIRED** instead of the
frozen NOT_ANSWERED outcome. No wrong knowledge grade is published, but the expected response distinction
and availability still fail. Its provider request is identical to the previous trial. This case must not
be relabeled after seeing the output to make the run pass. A review/fallback policy may be investigated
separately, with its own clear semantics and tests.

P2-07's preferred PARTIAL/CORRECT boundary also remains unresolved. That broader accepted band is not
independent proof of one precise action; it should be adjudicated as a coverage boundary separately from
the clear N15-03 failure. No prior answer, band, expected grade or semantic check was changed in this run.

### Comparison, repeats and limits

For the 16 initial cases shared with policy 15, actual provider-request hashes match in **five** and differ
in **11**. The five unchanged inputs are R1-08, H1-09, A1-01, P2-02 and N15-06. The other 11 use revised
guidance in the four scoped questions. Two incidental-true controls are new. This is a small diagnostic,
not a randomized accuracy estimate or an independent held-out domain sample. It uses owner-authorized
AI-reviewed expectations, not independent human/domain-expert validation.

Both repeats have new assessment IDs and reused=false; persisted answer text/hash, question hash, input
key and config hash match their first trials. Both primary labels/dispositions are stable and pass all
checks. Only the two selected cases were repeated. Do not infer all-case stability from their success.
First results/usage were saved before normal owner-only deletion of the two fictional scoped-bank
snapshots; their consumed budget was retained. Original-bank and prior assessment records remain unchanged.

Provider-reported usage: **50,725 input tokens, 17,483 output tokens** across 20 calls; no unknown usage.
Model latency p50 **10,156 ms**, p95 **15,290 ms**, max **16,202 ms**. Output usage includes reasoning;
LOW requested and reasoningContent presence observed in **20/20** responses. Only its presence was recorded,
never its text. Interpretation statuses: CLEAR 16, UNCERTAIN 2, NORMALIZED 2. These are model declarations,
not verified capture/meaning provenance. No cost estimate or production-latency claim is made.

Actor and global day counters moved **80 -> 100**. The dated private launcher checked exact counters before
and after every case, guarded clean revision/config/database/namespace, and capped each phase's SDK sends.
Only that approved process used actor ceiling 100. Source limits remain 20/admin/day and 100/global/day;
active learner policy remains 8. The existing daily global ceiling is now reached. No counter reset, new
identity, global-limit increase or additional call was made. No further same-day calls are planned.

### Evidence and launch commands

Private evidence in `/private/tmp/spasht-grading-validation/`:

- `question-scope-1-{canary,initial,repeat}.json` and their logs/per-case reports; `question-scope-1-merged.json`
  combines canary plus remainder without duplicate paid trials. The free controls explicitly show reused=true.
- `question-scope-1-{initial,repeat}-review.json`: frozen acceptance review.
- `question-scope-1-repeat-audit.json`, `question-scope-1-repeat-verification.json`: preserved first results
  and exact fresh-repeat input proof.
- `question-scope-1-{canary,initial,repeat}-transport.ndjson`: request hashes, mode/status enums, evidence
  list counts, stop reason, timing and usage; no raw provider body, interpretation-summary text or hidden reasoning.
- `question-scope-1-summary.json`: model-only metrics, original-bank input-hash comparison and offline
  shadow proposals. The shadow analysis assumes COMPLETE capture only to inspect grade consequences;
  no actual voice, adaptive-state write or learner question selection was performed.
- `question-scope-1-reconciliation.json`: restricted runtime role, original-bank/prior-assessment preservation,
  nine scoped question pins, final counters, source limits and unchanged current learner policy.

Approved phases were canary (1 call), initial remainder (17 calls plus two reused free controls), then
repeat (2 fresh calls after audited owner-only snapshot replacement):

```sh
env DATABASE_URL=postgresql://walkthrough_app@127.0.0.1:55443/spasht_grading_validation \
  SCOPE_BANK_CALLS_APPROVED=20 \
  node --import tsx --env-file=/Users/neelesh.ahankari/Applications/SpashtAI/apps/server/.env \
  /private/tmp/spasht-grading-validation/question-scope-approved.mts canary
```

This guarded launcher is dated/exhausted: do not rerun it. It passes one frozen case at a time into the
normal calibration/service path and checks disposition/usage before proceeding. Full bank pins are checked
at phase entry and again by the runner at each submission. The repeated case IDs and expected labels
were frozen before any model call. Secret env values were neither printed nor copied into the repository.

## Decision after measurement

**HOLD grade-driven adaptive selection.** Scoped requirements improve the targeted concise/mixed cases on
this run, but the model still infers a correct relationship from unresolved referents. A real score-driven
progression path cannot safely treat that result as demonstrated knowledge. Another blanket prompt rewrite,
score threshold change, or promotion of all mixed answers is not supported by this evidence.

Next investigation should focus on what evidence establishes the learner's asserted relationship, rather
than whether topic words match a bank answer. Preserve these counterexamples and compare any new mechanism
against concise correct, harmless-ASR, unresolved-reference, incidental-true and genuine mixed controls.
Do not fabricate a rule specific to N15-03 or count any missing grade as a semantic success. No extra
paid run is authorized or possible within the unchanged remaining daily cap; begin with offline analysis.

No merge, deploy, production bank update, active-policy switch or adaptive enablement. Integrated real
voice/workspace checks and broader/fresh/repeated validation remain outstanding even after semantic
issues are resolved. The local scoped bank and all previous evidence remain available for review.
