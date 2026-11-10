# LOW/MEDIUM reasoning comparison preparation — 11 November 2026

**Prepared, not real-model tested. Adaptive release HOLD.** This is an inactive Admin benchmark; active learner
policy remains 8. No paid call, production change, schema migration, deployment or live voice test occurred.
The previously approved 12-call diagnostic is complete and its allowance is exhausted.

## Why this experiment

The measured policy-16 uncertainty decision varies for identical saved inputs, and instruction echo is still
unnecessarily reviewed. The grading-boundary adjudication now distinguishes understandable partial knowledge
from unresolvable meaning. More wording changes would confound the next measurement.

The earlier Nova Pro benchmark already showed availability/control regressions and did not justify adopting
that model (`INTERVIEWS-PHASE-3.3b-FOLLOWUP.md`). No claim that a model name implies better grading is used here.
Instead, test one supported parameter on the existing AWS Nova 2 Lite: LOW versus MEDIUM reasoning.
[AWS extended-thinking documentation](https://docs.aws.amazon.com/nova/latest/nova2-userguide/extended-thinking.html)
describes these settings and tool use. It does not establish quality for our task or our account's acceptance
of a specific request. HIGH is excluded: its documented inference restrictions conflict with the bounded
maxTokens/temperature envelope used here. No claim of lower cost or better accuracy is made for MEDIUM.

## Frozen arms

| Property | LOW baseline | MEDIUM comparison |
| --- | --- | --- |
| Preview key | learner-evaluation-16 | learner-evaluation-16-thinking-medium |
| Model / region | us.amazon.nova-2-lite-v1:0 / us-east-1 | Same |
| Prompt / schema / rubric | interview-answer-17 / interview-result-10 / bank-guidance-6 | Same |
| Temperature / maxTokens / timeout | 0 / 15,000 / 40 seconds | Same |
| Grading policy, deterministic controls | Existing policy-16 semantics | Same |
| Reasoning effort | low | medium |

Config hashes:

- LOW: `0f6f309aec2d53806612cac4180f1b4349b6dca98c4681fe1e6e5f93ebe0148a`
- MEDIUM: `96c9ca8b6facab1f7e014435ed51bbb685936e989166785210ba3565c2e6feda`

Only registration metadata (`id`, `label`, `policy`) and effort differ. The actual provider request differs only
in `maxReasoningEffort`; tests compare messages, system prompt, tool schema/choice and inference envelope.
Existing configs are not edited, and unregistered combinations remain rejected. MEDIUM is offered only as
an existing-gated Admin preview on this experimental branch. No active-policy pointer or feature gate changes.

## Proposed trial, not authorized

- `thinking-medium-focused-1`: six exact cases from `grading-boundaries-1` per arm: B1-03 ambiguous fragments,
  B1-04 instruction echo, B1-01 clear partial/unassigned names, B1-02 complete focus-order reasoning, B1-05
  new clear partial and B1-08 explicit false core.
- `thinking-medium-repeat-1`: fresh repeats of B1-03 and B1-04 per arm; identical answer/expectation/question
  pins to their initial cases. Reusing saved results does not count.
- **16 paid calls maximum**: 6 initial + 2 repeats, times 2 arms. Canaries/failures count within 16; no automatic
  retries. Maximum configured output allowance 240,000 tokens, not an expected-use or price estimate.
- Pair the ambiguous canaries first (LOW then MEDIUM). Alternate which arm runs first for subsequent cases,
  and record order. This is a small diagnostic, not randomized statistical validation. Four of the ten future
  boundary cases are not covered here; broader validation remains necessary.
- Reuse the same existing fictional admin, namespace and normal accounting. Require all 16 calls to fit the
  actor/global normal remaining quota. No actor extension, counter reset, identity replacement or raised cap.
- Preserve old and initial-repeat evidence before any normal deletion/resubmission of exact selected owned
  fictional Admin tests. Retain usage; verify fresh IDs and identical answer/question/config/input/provider
  request hashes within each arm's repeats. Across arms, only the declared effort field should differ on wire.
- Use a durable cumulative call ledger; restart must not renew the allowance. Stop on unsupported request,
  provider/access, quota, timeout or prerequisite failure. MEDIUM may hit the existing bounds: report that
  observation rather than automatically raising them.
- Report knowledge correctness, required/unnecessary reviews, format availability, reasoning/feedback checks,
  repeat stability, actual total usage/unknown usage and model latency separately. Agreement alone is not truth.

No result is expected or fabricated for this new profile. Do not apply the future labels to old saved reports,
claim that a larger reasoning setting fixed uncertainty, or flip learner policy after a small sample pass.

## Observed local verification

Mocked evaluator tests pin active policy 8 and the old LOW hash, verify that only the expected config keys
change, compare the on-wire envelopes, enforce SDK maxAttempts 1, and exclude an authored private reasoning
marker from the returned result. Fixture guards require the six/two cases to exactly match the adjudicated
future acceptance definitions. The compact offline checker includes these tests and still replays the same
32 historical rows as HOLD; the ten future boundary cases remain explicitly untested by a real model.

Actual SDK HTTP used the owned existing Postman stand-in on local port 4932. **38 assertions and 38 POST
request events passed**, including bounded MEDIUM serialization, a declared-uncertain contradictory verdict,
throttling, wrong tool envelope, missing reasoning and exclusion of private reasoning content. These authored
responses prove caller handling only. No AWS credentials or model endpoint were used. The first bind attempt
was sandbox-blocked; local socket access then allowed the same fixture run. Only the owned listener was stopped;
shared API, voice and database services were untouched.

Read-only preflight passed all four combinations (two arms x six-case/two-repeat fixtures) on restricted
`walkthrough_app` at the existing isolated `spasht_grading_validation` database. Source budget limits remain
20/admin and 100/global. Budgets, assessment count and usage count matched before/after; provider sends were
explicitly disabled. The temporary actor-ID cache was absent; the same existing fictional Admin was verified
against its previously retained actor hash, without creating a user, changing roles or substituting identity.

At preflight, UTC day was still **2026-11-10** (early 11 November in Asia/Kolkata): actor/global usage 12,
normal remaining **8 / 88**. That is insufficient for 16 calls. Re-read quota after the next normal UTC day
begins (05:30 Asia/Kolkata, 11 November); a quota reset does not itself authorize the trial. Model/account
compatibility with MEDIUM is still unverified by a real-provider call. No paid diagnostic was run.

## Evidence and next gate

Private setup/logs are under `/private/tmp/spasht-medium-preparation/`: `http-results.json`, `http.log`,
`simulation.ndjson`, `simulation.err`, `preflight-summary.json`, four bank/config preflight reports,
`server-tests.log`, `replay-rerun.log`, `server-tests-rerun.log` and `build.log`. No auth, environment file,
recording, real hidden reasoning or raw provider output is committed. Simulation context records fixture
support separately from unknown provider semantics.

The next live step requires a **new explicit allowance of at most 16 AWS calls**, enough normal quota and a
clean committed revision. The candidate must earn its outcome through that run. No merge/deploy or adaptive
release is authorized by this preparation.

## Final local check results

- **211 focused offline tests + six network-guard checks passed.** Saved historical evidence remains HOLD;
  no MEDIUM model result is manufactured or inserted into that replay.
- **Server build and strict script/test TypeScript checks passed.**
- First broad serial run: 803 passed, one Replay workflow test failed (replacement analysis path returned 404
  instead of 200), 290 optional/database checks skipped. Replay code/tests were not changed here. Isolated
  rerun passed all 12 Replay checks; the final full serial rerun passed **805 tests**, 290 skipped. The isolated
  rerun supports a nonpersistent failure in this run, not a claimed root-cause fix for Replay. Both logs retained.
- Actual local SDK HTTP: 38 passed assertions and 38 request events. Only the owned listener was stopped.
- The compact preparation summary and selected private logs are also retained durably in the ignored
  `tools/interview-grading/runs/medium-preparation-2026-11-11/` directory, so later agents can start with
  `summary.json` instead of reconstructing every log. No real model credentials or live provider bodies used.

## Prespecified comparison interpretation

MEDIUM is not advanced merely for a higher average. Any graded answer for the required unresolvable-meaning
case, full credit for a clear-partial case, false-core promotion, instruction-echo technical credit, invalid
output or failed repeat is a blocker on this focused set. Unnecessary review stays a separate failed check,
not a correct knowledge grade. To justify broader testing, MEDIUM must pass all selected checks/repeats and
show a useful observed difference over the matched LOW arm, without new availability failures. If both arms
pass, this diagnostic alone does not justify switching policy or accepting extra resource use.
If a provider/bounds failure prevents completion, report the comparison incomplete rather than silently
replacing cases or expanding resources. A positive focused result only permits considering broader validation,
never automatic promotion. Actual cost/latency must be measured; no pricing ratio is assumed here.

The simulation context also had an older unquoted colon in a prose scalar. Existing claim text was preserved
and quoted consistently; the resulting YAML parsed successfully with both new claims and all prior entries.
