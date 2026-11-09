# AWS Nova extended-thinking comparison — 9 November 2026

Completed the explicitly approved 20-call real-model comparison on application revision
`379c23ce50bf32b21a1b9eb5b2305f6f56232e8c`. **HOLD grade-driven adaptation.** LOW improved two targeted cases,
but did not resolve uncertain speech or implicit reasoning. No learner-policy change, deployment or adaptive
enablement. Policy 14's earlier benchmark is in `INTERVIEWS-GRADING-POLICY-14.md`; it also remains HOLD. This experiment changes model
runtime configuration while preserving prompt 16, schema 8, rubric 6, source passages and grading checks.

## Why compare this next

The targeted knowledge/reasoning conflict improved in policy 14, but malformed core fields, missed implicit
reasoning, unclear speech and an incorrect ASR penalty remain. Another prompt rewrite would obscure whether
more model effort helps. AWS supports optional extended thinking on Nova 2 Lite; it is off by default and
our previous evaluator runs did not enable it. Improvement is a hypothesis, not an established capability
for this task. No external/non-Amazon model is introduced.

## Resource-matched arms

Both use Amazon Bedrock `us.amazon.nova-2-lite-v1:0`, us-east-1, temperature 0, one SDK request attempt,
**15,000 maximum generation tokens per call and a 40-second request timeout**. Both use the exact same
question/answer/prompt/tool input and grading validator. This larger experimental envelope is not a proposed
production latency target or an automatic retry/limit expansion.

- `learner-evaluation-14-budget-control`: extended thinking left at the provider default OFF. Config hash
  `59d0d74942166c3aaed28cc8a0f484ab0fb1331d775289af960d7842a7a56bea`.
- `learner-evaluation-14-thinking-low`: additionalModelRequestFields.reasoningConfig =
  `{type: enabled, maxReasoningEffort: low}`. Config hash
  `b5f0749eea9fd6a5398cd3274f8edb6f78aa46c6b95dd8e9c8fd7fed9c7806af`.

The matched control prevents attributing a difference solely to thinking when the token ceiling/timeout
also changed from policy 14's original 2,000/20 seconds. Config IDs differ for persistence/deduplication;
those IDs/labels are not passed as grading instructions. Earlier configurations and ACTIVE policy 8 stay frozen.

AWS documentation: [extended thinking](https://docs.aws.amazon.com/nova/latest/nova2-userguide/extended-thinking.html),
[Nova 2 Lite capabilities](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html).
Reasoning tokens are billable. The caller ignores reasoningContent and persists only validated assessment
plus usage/timing; no hidden reasoning text is exposed to users or saved in result/error logs. Do not enable
HIGH, remove bounds, automatically increase tokens or use a new model/provider to rescue failures.

## Frozen small trial and exact cost bounds

`thinking-comparison-focused-1` freezes eight existing model-evaluated cases per arm:
R1-08, H1-09, P2-07, P2-08, A1-01, A1-05, P2-06, P2-02. These cover false core, relevant incomplete
proposal, implicit reasoning, ambiguous speech, harmless ASR, actual wrong answer, mixed knowledge and
instruction echo. Existing expected labels/checks are copied unchanged from policy 14. Two deterministic
controls also run per arm but are free and excluded from model accuracy.

`thinking-comparison-repeat-1` repeats P2-08 and A1-01 with fresh accounted assessments per arm.
Eight initial + two repeated invocations per arm = **20 paid calls maximum in total**, including canaries.
Four deterministic controls are additional no-provider outcomes, not four extra model calls. The maximum
configured generation allowance across all calls is 300,000 tokens; actual usage, including provider-reported
output usage, must be measured. No dollar estimate is asserted. Token/latency envelopes exceed earlier runs
and must be explicitly included in approval.

Start with a canary already included in each arm. Stop on unsupported configuration, access denial, token
limit failure or unavailable prerequisite; do not spend the remaining batch or silently enlarge bounds.
Any retry consumes the same capped allowance and displaces another planned call. Preserve incomplete runs
honestly. The normal 9 November Admin allowance and the approved policy-14 batch are already consumed
(recorded usage 40); the new owner approval supplied exactly 20 additional calls, not a leftover prior-day allowance.

Save first-trial evidence before owned fictional snapshot replacement. Match input/config hashes on repeats;
never count a deduplicated result as replication. Keep separate arm files and inspect errors, exact evidence,
reasoning findings, semantic checks, provisional/held grades, expected review outcomes and resulting shadow
actions. Record whether the response contained reasoningContent blocks using a boolean only, never their text,
to verify that the requested mode actually took effect. If this cannot be observed, report the limitation
instead of assuming the provider honored the setting. Compare the same inputs with each other, not full-set
percentages from earlier different selections.
No requirement, disposition or accepted band is changed after seeing results.

## Acceptance and limits

Report model-only availability, wrong credit/penalties, ungraded-review correctness, reasoning/feedback quality,
repeat/routing stability and latency/token usage independently. A retained core grade with assessmentIssues
still requires hold and fails adaptive acceptance. A stable wrong disposition is not a reliable result.
This small known regression set cannot establish general-domain accuracy, fairness, or release readiness.
Broader frozen cases, fresh cases and real automated voice/workspace tests remain necessary before rollout.

## Prepared-code validation (not model results)

- 141 focused tests passed, including exact same input/tool schema/inference envelope across arms and only
  the intended low-effort field added. Source policy-14 default requests remain unchanged.
- Full server serial suite: 714 passed, 290 optional/database tests skipped. Server build and strict checks
  of calibration/HTTP scripts passed.
- Real SDK HTTP to the owned local stand-in: 21 assertions passed, including both request shapes and exclusion
  of fixture reasoning content from saved results. This is authored fixture transport evidence only.
- Those preparation checks preceded the real-model results below. No spoken scenario was run: this changes
  only an inactive Admin grading preview, not live voice capture or learner policy. No integrated adaptive
  voice/workspace acceptance or production readiness is claimed.

Private ignored evidence: `/private/tmp/spasht-grading-validation/thinking-low-focused.log`,
`thinking-low-server-serial.log`, `thinking-low-http-results.json`, `thinking-low-simulation.ndjson`.
The fixture was stopped; shared services were untouched. Secrets/auth/audio/rejected model bodies are not
committed. Approval for this bounded comparison is separate from permission to deploy or promote anything.


## Observed results on the frozen candidate

Only AWS Bedrock Amazon Nova 2 Lite was invoked. The OFF canary ran first, then LOW canary; OFF remainder
and repeats preceded LOW remainder and repeats. This is a small sequential diagnostic, not a randomized
statistical trial. All canaries count toward the 20. No retries, provider errors, invalid schema results,
request timeouts, token-limit errors, or server-held core grades occurred. No output met the expected
ungraded-review disposition. A structurally usable result does not establish semantic correctness.

| Measure | OFF | LOW |
| --- | ---: | ---: |
| Paid first trials | 8 | 8 |
| Structurally usable first grades | 8/8 | 8/8 |
| Accepted classification band, first trials | 6/8 | 7/8 |
| Preferred grade/disposition, first trials | 5/8 | 7/8 |
| All frozen checks pass, first trials | 4/8 | 6/8 |
| Expected uncertain case safely ungraded | 0/1 | 0/1 |
| Fresh repeat trials | 2 | 2 |
| All frozen checks pass, repeats | 0/2 | 1/2 |
| Same primary label on repeat | 2/2, both wrong | 1/2 |
| Free deterministic controls | 2/2 pass | 2/2 pass |
| Model latency p50, all 10 calls | 1,967 ms | 5,485 ms |
| Model latency p95/max, all 10 calls | 2,523 ms | 14,526 ms |
| Provider input tokens, all 10 calls | 24,518 | 25,018 |
| Provider output tokens, all 10 calls | 1,919 | 9,192 |
| Responses containing reasoningContent | 0/10 | 10/10 |

Paid metrics exclude the free controls. Expected ungraded review has no grade, so it is counted separately
from acceptable grade bands. LOW used about 4.8 times the reported output tokens and 2.8 times the median
latency on this set. Provider output usage includes thinking; it is not a count of visible feedback tokens.
No dollar-cost or general performance claim is made. The extra 50 input tokens per LOW call are provider
reported; application message/system/tool/inference inputs hash identically in every matched pair.

| Case | OFF first / repeat | LOW first / repeat | Frozen semantic review |
| --- | --- | --- | --- |
| R1-08, false core | INCORRECT / not repeated | INCORRECT / not repeated | Both pass |
| H1-09, relevant incomplete idea | PARTIAL / not repeated | PARTIAL / not repeated | Both pass |
| P2-07, implicit reasoning | PARTIAL / not repeated | PARTIAL / not repeated | Both fail: valid reasoning not credited |
| P2-08, ambiguous speech | NOT_ANSWERED / NOT_ANSWERED | INCORRECT / NOT_ANSWERED | All fail: expected ungraded review; LOW also changes disposition |
| A1-01, harmless transcription substitution | INCORRECT / INCORRECT | CORRECT / CORRECT | OFF fails grade and forbidden gap; LOW passes frozen checks twice |
| A1-05, genuinely wrong control | INCORRECT / not repeated | INCORRECT / not repeated | Both pass; LOW did not simply forgive all errors |
| P2-06, mixed true/false knowledge | INCORRECT / not repeated | PARTIAL / not repeated | OFF misses correct strength/preferred grade; LOW passes |
| P2-02, empty instruction echo | NOT_ANSWERED / not repeated | NOT_ANSWERED / not repeated | Both pass |

LOW's A1-01 feedback still recommends the formal tool name “git bisect.” This does not fail the frozen
checks, but is a remaining wording concern when the name is a transcription substitution. Do not describe
this as proof of universally ASR-neutral feedback. Do not re-label the benchmark after observing outputs.
P2-07's retained core grade does not mean valid reasoning was assessed. LOW's mixed-answer improvement
was observed once; it was not one of the approved repeats.

### Safety and routing consequences

The unwired shadow router was inspected offline with an explicit COMPLETE-capture assumption, solely to
expose grading consequences. This is not actual capture provenance or an adaptive state write.

- A1-01: OFF proposes SIMPLIFY; LOW proposes DEEPEN consistently on two trials.
- P2-06: OFF proposes SIMPLIFY; LOW proposes CLARIFY (not repeated).
- P2-08: LOW first proposes SIMPLIFY with a knowledge update, then CLARIFY_RESPONSE without one.
  Both should instead be held for uncertain interpretation. OFF's stable CLARIFY_RESPONSE also fails
  the required ungraded-review outcome. A safe router cannot detect semantic uncertainty the evaluator
  failed to expose; passing schema/evidence-reference checks does not solve this.
- No shadow proposal was applied to a learner or question bank. Active learner policy stays 8.

### Evidence, accounting and reproducibility

Private evidence directory (mode 700): `/private/tmp/spasht-grading-validation/`.
No credentials, raw rejected provider bodies, hidden reasoning text, recordings or auth state are committed.
Transport observers recorded only matched request hashes, requested-mode boolean, reasoning-block presence,
stop reason, tool count, timing and token usage; they returned responses unchanged.

Files:
- `thinking-{off,low}-canary.json`, `thinking-{off,low}-initial.json`, `thinking-{off,low}-repeat.json`:
  normal Admin assessment-path reports. `initial` files exclude the already executed canary.
- `thinking-{off,low}-merged.json`: first-trial rows from canary + remainder, preserving source reports;
  no duplicate/reused canary or invented aggregate summary.
- `thinking-{off,low}-{initial,repeat}-review.json`: frozen offline acceptance; all four reviews exit 1
  for HOLD, intentionally. Controls remain separate in model-only summary.
- `thinking-{off,low}-repeat-audit.json`, `thinking-{off,low}-repeat-verification.json`: first results
  preserved before normal owner-only fictional snapshot deletion. Four repeats have new assessment IDs,
  reused=false, identical answer text/hash, question hash, input key and per-arm config hash.
- `thinking-{off,low}-{canary,initial,repeat}-transport.ndjson`: 20 real invocations, 10 matched input pairs;
  LOW reasoning block observed on every response, OFF on none. No hidden reasoning text retained.
- `thinking-comparison-summary.json`: model-only metrics and offline shadow proposals.
- `thinking-budget-reconciliation.json`: restricted walkthrough_app role (no superuser/RLS bypass), all
  nine required distinct question revisions active/approved/pinned; actor/global usage 40 -> 60.

The approved phase order was `off canary`, `low canary`, `off initial`, `off repeat`, `low initial`,
`low repeat`. A private guarded launcher pinned revision/config hashes/date/database, required explicit
20-call approval, checked exact persisted budget before each phase, limited SDK requests per phase to
1/7/2, and set only that process's actor ceiling to 60. Source/prod limits remain 20/admin/day and
100/global/day. Reused results and retries did not consume hidden extra trials. All 20 approved calls were
used. Do not rerun the dated launcher or reset counters; further paid testing needs a new bounded allowance.

Launch pattern used (private env file supplies credentials without printing or copying them):

```sh
env DATABASE_URL=postgresql://walkthrough_app@127.0.0.1:55443/spasht_grading_validation \
  THINKING_COMPARISON_APPROVED=20 \
  node --import tsx --env-file=/Users/neelesh.ahankari/Applications/SpashtAI/apps/server/.env \
  /private/tmp/spasht-grading-validation/thinking-approved.mts off canary
```

The normal calibrator accepts `--model learner-evaluation-14-budget-control` or
`--model learner-evaluation-14-thinking-low`, `--fixture thinking-comparison-focused-1` or
`thinking-comparison-repeat-1`, and `--only` case IDs. The private launcher constrains those selections and
phase accounting. It is not a production quota override to copy into the application.
Offline review command, replacing ARM and matching repeat fixture/report when needed:

```sh
node --import tsx apps/server/scripts/review-interview-calibration.ts \
  apps/server/test/fixtures/interview-calibration-thinking-comparison-focused-1.json \
  /private/tmp/spasht-grading-validation/thinking-ARM-merged.json \
  /private/tmp/spasht-grading-validation/thinking-ARM-initial-review.json
```

## Decision and next work

Keep both modes experimental. LOW is a useful candidate for further testing, not a promotion decision.
Before more model spend, examine the failed ambiguity and implicit-reasoning cases against question
intent/guidance, and design a narrow interpretation/uncertainty contract that distinguishes uncertain
transcription from actual false knowledge without forgiving the genuine-wrong control. Preserve the
knowledge/reasoning separation and exact evidence safeguards. Do not infer a universal uncertainty detector
from one phrase or use a hard-coded fixture answer to pass. Freeze the next acceptance cases before calling
models again, including fresh cases and false-uncertainty controls. Revalidate on broader frozen domains,
fresh inputs, repeats and real automated voice/workspace paths before adaptive enablement.

No merge, deployment, model switch, production quota change, active learner grading change or adaptive
question selection was performed or authorized by this experiment. Git publication of this evidence does
not change production.
