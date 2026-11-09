# Unchanged-model ambiguity diagnostic — 9 November 2026

**Prepared and bank/configuration-preflighted, not model-tested. Adaptive release HOLD.**
This checkpoint does not introduce policy 17, change a prompt/model/parser, or touch active learner policy 8.
It measures the remaining question before proposing another patch: does policy 16 reliably distinguish a
stated relationship from the same topic words without that relationship?

## Frozen inputs and proposed bound

Use the existing AWS Bedrock Nova 2 Lite preview `learner-evaluation-16`, LOW thinking, temperature 0,
15,000 maximum output tokens and 40-second per-invocation timeout. Configuration hash:
`0f6f309aec2d53806612cac4180f1b4349b6dca98c4681fe1e6e5f93ebe0148a`.
Use the existing `grading-scope-1` bank and normal ADMIN_TEST accounting/service path; no new identity,
production calls, runtime overrides or altered global quota.

- `interview-calibration-ambiguity-baseline-1.json`: nine initial paid cases. Six exact contrasts from the
  previous checkpoint plus unchanged historical N15-03 (unresolved referents), N15-01 (concise correct), and
  P2-02 (instruction echo/empty slogan).
- `interview-calibration-ambiguity-repeat-1.json`: three fresh paid repeats of those historical controls.
  Answers, expected checks, bank guidance, question revision, configuration and provider input must match
  their new initial trials. Reusing an existing saved result is not a fresh repetition.
- **Maximum 12 provider invocations**, including any canary. No automatic retries; a failed call still counts.
  Maximum configured output allowance: 180,000 tokens, not a spending estimate or expected usage.
  Nine initial trials plus three repeats cannot establish general-domain calibration or production readiness.

No labels changed. Historical fixture/report files remain intact. Exact control/repeat identity is checked by
`plan-interview-diagnostic.ts`, alongside question pins, configuration hash, uniqueness, counts, deterministic
controls and preservation of the six new contrasts. The existing ambiguous-answer failure remains visible in
`npm run grading:check`; new case preparation never turns that saved failure into a pass.

## Observed no-provider preflight

Against the existing isolated `spasht_grading_validation` database on 127.0.0.1:55443:

- The restricted `walkthrough_app` role has neither superuser nor RLS bypass privileges.
- All selected approved question/configuration pins pass the normal calibrator's `--preflight`, for nine
  initial cases and three repeat cases. The fictional admin has evaluator access.
- Bedrock SDK sends were explicitly disabled. **Zero provider calls.** All budget rows, assessment count
  and usage count matched before/after. No tests were deleted and no flags or counters changed.
- Three selected existing snapshots are present. Before paid execution, preserve original full private
  evidence and verify those exact fictional owned ADMIN_TEST records. Only then use normal service deletion
  and resubmission to obtain fresh inputs; usage must remain retained. Do not clear the database or delete
  unrelated/learner records. Archive the nine new initial results before preparing the three repeats too.
- UTC day `2026-11-09`: actor usage 100, global usage 100. Current normal limits are 20/admin and 100/global;
  both normal remaining allowances are zero. The earlier separately approved process-only actor extension
  is not in effect. **No paid test can proceed today under normal limits.**

The first database attempt was blocked by local sandbox access; the same guarded read-only preflight then
passed with local database access enabled. No application workaround or database configuration change was made.
Private evidence: `/private/tmp/spasht-grading-validation/ambiguity-baseline-1-preflight.json`,
`ambiguity-repeat-1-preflight.json`, and `ambiguity-diagnostic-preflight-summary.json`.
The preflight used this checkpoint's working tree; fixture hashes are available from the offline plan command.

A normal new UTC day begins at **05:30 Asia/Kolkata on 10 November 2026**. Re-read counters at execution;
other work may consume quota. Reset does not itself authorize paid testing. A new bounded allowance is required;
never reset counters, change identities or raise the global ceiling to fit this experiment.

## Run and acceptance procedure after authorization/quota are available

1. Pin a clean committed application revision, unchanged policy hash and all fixture hashes. Verify restricted
   local target, access, normal remaining quota sufficient for 12, no unrelated pending/running Admin jobs,
   and provider prerequisites without revealing credentials. Do not start a broad sweep over other tests.
2. Preserve original evidence before any normal deletion of the three exact historical fictional Admin tests.
   Verify normal enqueue reports `reused: false`. Run initial trials with a process-level 12-send bound and
   preserved per-case results/accounting. No environment file, hidden reasoning or raw provider body in Git.
3. Save initial results before normal deletion/resubmission of only the three repeat tests. Verify fresh IDs,
   identical answer/question/config/provider-input hashes and retained usage. A resumed script must count
   prior attempts against the same 12-call bound; never restart the allowance.
4. Stop on access, quota, configuration, provider, timeout or prerequisite failure. Preserve failure evidence;
   do not spend extra calls on automatic retries. Ordinary semantic failures are diagnostic observations,
   not an excuse to edit the fixture mid-run.
5. Run the existing offline reviewer on both reports. Separate unsafe credit (N15-03/C1-04), unnecessary
   review, false-role recognition, ordinary correct answers, output-format availability, reasoning checks,
   repeat stability, latency and actual token usage. No model/error/review outcome becomes an incorrect
   learner answer or inferred knowledge gap.

If policy 16 still invents relationships, it remains rejected for adaptive promotion. A later single-mechanism
candidate needs a separately bounded matched comparison; do not assume grouping passages or another instruction
fixes it. If the contrast cases pass but original N15-03 fails, report that distinction rather than claiming an
ambiguity fix. Any passing result is only this diagnostic. The separate P2-07 preferred routing-label question,
broader regressions, fresh/repeated reliability and eventual real automated voice/workspace acceptance remain.
No deploy, merge or adaptive enablement is authorized by this document.

## Simple local reuse

From this worktree's repository root:

```sh
npm run grading:plan
npm run grading:check
```

Both commands need only installed repository dependencies; no chat agent, AWS credentials, database or live
services. `grading:plan` prints proposed counts, bounds, hashes and prerequisites. It does **not** connect to
check current quota/access or run paid tests. `grading:check` runs mocked code regressions and replays saved
synthetic evidence; its current HOLD/exit 2 is expected. See `tools/interview-grading/README.md`.

## Local code checks

196 focused tests and six network-guard checks passed. Negative tests reject changed historical labels,
altered repeat answers, changed question pins, duplicate cases and drifting contrast answers. The standalone
planner passed strict TypeScript checking. Default saved-evidence review still reports HOLD, preserving the
three existing disagreements. These are offline/regression results, not twelve new model observations.
