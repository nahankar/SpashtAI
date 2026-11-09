# Prepared AWS Nova extended-thinking comparison — 9 November 2026

Not run against the real model. No learner-policy change, deployment or adaptive enablement. Policy 14's
completed benchmark is in `INTERVIEWS-GRADING-POLICY-14.md`; it remains HOLD. This experiment changes model
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
(recorded usage 40); no call in this comparison is currently authorized by a leftover prior-day allowance.

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
- No real reasoning-mode invocation or spoken scenario has been run. No performance/grade benefit is claimed.

Private ignored evidence: `/private/tmp/spasht-grading-validation/thinking-low-focused.log`,
`thinking-low-server-serial.log`, `thinking-low-http-results.json`, `thinking-low-simulation.ndjson`.
The fixture was stopped; shared services were untouched. Secrets/auth/audio/rejected model bodies are not
committed. Approval for this bounded comparison is separate from permission to deploy or promote anything.
