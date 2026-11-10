# Unchanged-model ambiguity diagnostic — 9 November 2026

**Completed the separately approved 12-call diagnostic on 10 November 2026. Adaptive release HOLD.**
The preparation record below is retained; observed real-model results follow it.
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

## Completed approved diagnostic — 10 November 2026

Tested clean application **`ffa70ed326db3cfd737227fce08c65fc4cbbb379`**, unchanged policy 16/configuration above,
normal restricted local runtime, and the frozen nine-case/three-repeat fixtures. No evaluator/agent source changes
exist between the prior scoped-bank trial and this tested revision. The owner approved at most 12 AWS calls.
**Exactly 12 fresh invocations completed**, no reused results, retries, timeouts, provider/access errors,
max-token failures or invalid-output jobs. All 12 responses had a reasoning-content block; only its presence
was recorded, never hidden reasoning text. Actual results are the normal service's parsed/persisted output.

The private launcher verifies approval, UTC day, isolated database, clean revision, access, restricted role,
question pins and normal remaining quota. Exclusive durable per-call reservations enforce the cumulative
12-send bound across phases; restarting a process cannot renew it. SDK max attempts remained one. Only this
launcher process reduced the worker's retry ceiling from three to one to enforce the approved no-retry run;
no source, quota ceiling, model configuration or active scoring policy changed. Existing private credentials
were loaded without printing them. No extra model/provider-access probe was used.

Before initial submission, full private evidence for exactly three selected fictional owned ADMIN_TEST records
was archived, then those records were deleted through the normal service. Before repeats, the three new initial
records were likewise archived and normally deleted. Content-free usage was retained. Every submission was
fresh; repeat IDs differed while answer/question/configuration/input-key and actual provider-request hashes
matched. The six other initial results remain saved normally. No learner records were deleted.

| Diagnostic case | Frozen expectation | Initial observation | Fresh repeat |
| --- | --- | --- | --- |
| C1-01 explicit correct roles | CORRECT | CORRECT | Not selected |
| C1-02 resolved pronouns | CORRECT | CORRECT | Not selected |
| C1-03 meaningful ellipses | CORRECT | CORRECT | Not selected |
| C1-04 clear role descriptions, names unassigned | Ungraded review | PARTIAL; missing mapping acknowledged | Not selected |
| C1-05 explicit reversed roles | INCORRECT | INCORRECT | Not selected |
| C1-06 recoverable technical-name ASR | CORRECT | CORRECT, NORMALIZED | Not selected |
| N15-03 genuinely unresolved fragments | Ungraded review | EVALUATION_REVIEW_REQUIRED | Same |
| N15-01 concise correct distinction | CORRECT | CORRECT | Same |
| P2-02 instruction echo / empty slogan | NOT_ANSWERED | EVALUATION_REVIEW_REQUIRED | Same |

Initial: **7/9** rows satisfy all frozen checks (six expected grades plus one expected ungraded review).
Seven structurally usable grades were published, including the disputed C1-04 PARTIAL. Repeats: **2/3**
satisfy frozen checks (one grade plus one expected review). All three repeat dispositions were stable.
Those counts preserve the frozen labels; they do not count every ungraded output as success.

### Interpretation of the two disagreements

**C1-04 is a label-boundary dispute, not demonstrated invented mapping.** Its answer clearly describes two
roles and then admits it cannot attach fact/dimension names to them. The result explicitly lists the missing
mapping as a gap and gives PARTIAL. It does not falsely assert that the learner named both table types correctly.
This differs from N15-03, whose fragments do not establish a connected proposition. My AI technical review
recommends treating C1-04 as understandable but incomplete knowledge in a future version, while retaining
review for unclear meaning. That recommendation is not independent expert validation. The frozen fixture
has **not** been changed, and this trial has not been retroactively rescored. Treating both kinds of uncertainty
as the same would encourage unnecessary review. The early description of this result as unsafe credit was
too strong; inspecting the actual feedback supports this narrower conclusion.

**P2-02 remains an unnecessary review under the original expectation.** It contains instruction-like wording
and an empty causal fragment, without a substantive proposition to grade. Both new trials abstained for
uncertainty instead of recognizing NOT_ANSWERED. Neither produced a false knowledge grade. In the existing
shadow policy, review holds the turn whereas NOT_ANSWERED requests clarification; this is a functionality
boundary as well as an availability issue.

### The historical unsafe result is still relevant

N15-03 is correctly ungraded in both fresh trials today. However, its archived 9 November result was CORRECT.
The old/new answer hash, question hash, configuration hash and persisted input key are identical. No evaluator
source change occurred. The provider request hashes also match between today's two trials; the old trial's
transport hash used a different projection, so no byte-identical old/new transport-body comparison is claimed.
Today's success is evidence of two safe outcomes, **not evidence of a fix** or reliable ambiguity detection.
A temperature-zero run can still vary. The older unsafe outcome remains in the offline replay and continues
to block a reliability claim. P2-07's separate preferred adaptive-label disagreement remains outside this trial.

### Accounting, preservation and evidence

- Actor and global day usage each advanced **0 -> 12**, within unchanged normal limits 20/admin and 100/global.
  The approved 12-call allowance is exhausted. No additional calls are authorized by unused normal quota.
- Exactly 12 added usage records; old content/token/timing/outcome records retained. Normal deletion only
  removes their links to the selected archived tests. All 252 unrelated assessments and the entire local
  question bank compare unchanged after normalizing database Date objects to saved JSON representation.
- The first reconciliation reported a difference because the private audit hashed Date instances differently
  from their saved strings. Field comparison found no content differences, missing/extra rows or order changes.
  Read-only reconciliation with consistent serialization passed. No database repair or model rerun occurred.
- Input tokens **29,874**; output tokens **9,716**; unknown usage **0**. Model latency p50 **6,442 ms**,
  p95/max **12,360 ms**. These are measured model-call times, not a general performance or price claim.
- Shadow routing was inspected under an explicit COMPLETE typed-capture assumption only. No live question
  selection, knowledge-state update, voice test, production operation, merge or deploy occurred. Active policy 8
  stays unchanged. A valid-looking C1-04 PARTIAL would currently permit a shadow knowledge update; whether
  that is desired follows the label/product boundary above, not a hidden API/voice pass.

Private evidence directory: `/private/tmp/spasht-grading-validation/ambiguity-2026-11-10/` (mode 700).
It contains the exclusive call reservations, `baseline.json`, `historical-selected-archive.json`,
`repeat-initial-archive.json`, normal `initial-cases/` and `repeat-cases/` reports, combined reports,
`transport.ndjson` (content-free metadata), `*-proofs.json`, `*-review.json`, `prior-input-comparison.json`,
`reconciliation.json`, the initial `verification-difference.json`, and compact `summary.json`.
Private launch/audit helpers remain outside Git; credentials, operational identifiers, recordings, raw provider
bodies and hidden reasoning are not committed.

Two allowlisted synthetic result projections are committed so `npm run grading:check` now replays the old
20-row evidence and today's nine initial/three repeat rows without provider calls. It preserves all failures and
reports each dataset separately. The new projection tests pin source revision and expectation-file hashes.
**200 focused tests plus six network-guard checks passed; the combined saved-evidence result is HOLD.**
This is code/replay validation, not 32 new model trials.

Next work should separate clear incomplete knowledge from unresolvable transcript meaning, preserve the old
unsafe outcome, and address unnecessary reviews. Do not change another prompt just because two repeats were
safe. Any proposed model/parser change needs its own measured comparison and new bounded allowance. Broader
reliability and actual automated voice/workspace validation remain required before adaptive release.

Future-only resolution of C1-04 and P2-07 is recorded in `INTERVIEWS-GRADING-BOUNDARY-ADJUDICATION.md`.
The completed trial above retains its original labels, outcomes and HOLD conclusion.
