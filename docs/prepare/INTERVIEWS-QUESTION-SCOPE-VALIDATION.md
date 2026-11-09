# Isolated question-scope validation — 9 November 2026

**Test bank prepared; real-model grading remains untested and adaptive release remains HOLD.**
No production changes, model calls, scoring-policy changes or live voice tests in this task. Active learner
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
approval/activation. Prior assessment records and paid quota counters are unchanged. Two new deterministic
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

A future separate allowance of **20 paid calls maximum** covers 18 initial cases plus two repeats; the
canary is included. Two free controls may reuse their already saved deterministic results and must not
be represented as independent model replications. Paid trials and repeats must be fresh, with preserved
initial evidence and verified identical answer/question/config/input hashes for repeats. This allocation
does not repeat every case or establish general-domain reliability.

Use Amazon Bedrock Nova 2 Lite with the existing policy-16 config, LOW thinking, 15,000-token cap and
40-second timeout. No prompt/schema/model or resource expansion is proposed for this bank experiment.
The maximum configured generation allowance is 300,000 tokens; actual usage/latency must be reported.
Stop on unsupported configuration, access, prerequisites or token-limit failures; retries displace planned
cases within the same total. No extra calls are authorized by the earlier exhausted allowance. Paid day
usage remains 80; if a same-day 20-call run is later approved it reaches the existing global limit 100.
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
This document prepares an experiment; it does not authorize spending, merge, deploy or adaptive enablement.
