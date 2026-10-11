# Phase 2b — Admin answer evaluator pilot

This extends the single-copy question bank on `codex/interviews-simple-bank`.
It does not change question authoring/version management or the current voice,
Replay, Elevate, Coach, points or Progress Pulse settings. Live interviews remain
Phase 3. The engineering pilot is local; no merge, push or deployment is included.

## Try it

Open a saved question in Admin → Interview Question Bank → **Test answer**.
Enter a synthetic answer, select the model and record any hint/example assistance.
Evaluation is saved immediately and continues in the background. Recent tests
can be reopened after returning to the question. Duplicate submissions reuse
their persisted test, including any in-flight work.

The internal `interview_evaluator` capability uses the existing Feature Flags
and selected-user grant mechanism. It defaults hidden, disabled, and selected
users. Submission, retry and execution all require the current database Admin
role and evaluator access. Super Admin is not a feature-gate bypass. Owner or
current Super Admin can read/delete saved tests even when execution is disabled.
Flag/grant management also checks the current database role.

The local preview uses web 5174, API 4010, PostgreSQL port 55441/database
`postgres`. It contains the imported `automation-pilot` questions and the older
`workbook_verification` bank. These existing banks were not deleted or edited
by evaluator testing. Do not confuse this preview with main's API 4000/database.

## Evaluation contract

- Models: `us.amazon.nova-2-lite-v1:0` (default pilot) and
  `amazon.nova-pro-v1:0` (comparison), both invoked from `us-east-1`.
- Configuration and prompts live in versioned code, independent of voice and
  Replay settings. Every assessment saves exact model/region, prompt/schema/
  rubric/policy versions, generation limits and assistance policy.
- Bank guidance is an evaluation blueprint, not an exact-string answer key.
  Valid alternatives and terse correct answers are allowed; optional depth is
  not automatically required for Simple questions.
- Classification: Correct, Partially correct, Incorrect, Does not know/no answer.
  Accuracy, Reasoning and Depth each include findings and exact answer quotes.
  No numerical/composite score or Pulse entry is produced. Silence cannot
  establish subject understanding. Example-assisted answers are marked
  **After example** rather than independent recall.
- Candidate speech/text and bank fields are untrusted data. They cannot change
  the evaluator's instructions. Strict JSON contracts reject extra scores,
  missing/duplicate criteria, invented evidence and malformed outputs. Failed
  validation is a failed test with measured usage, never an invented verdict.
  A negative Reasoning/Depth finding with no quote is instead left unassessed,
  with a server-owned validation note visible in the report. This removes an
  unsupported finding without changing the model's classification or inventing
  evidence. Accuracy findings, positive/partial findings without evidence and
  quotes absent from the answer still fail validation. Validation failures save
  a content-free reason code; raw model output is not logged or retained.
- Correct/Partial/Incorrect map in application code to Deepen/Clarify/Simplify.
  Their generated follow-ups are proposals requiring relevance/difficulty
  review, not yet spoken live. Does not know maps to Change topic: the server
  selects an approved, active, spoken-suitable Simple/Medium question in the
  same namespace/track with a different non-General topic. When unavailable,
  it reports that fact. No model enum alone can claim a topic switch succeeded.

## Database and processing

`20261012100000_interview_evaluator` adds:

| Object | Purpose |
| --- | --- |
| InterviewAnswerSnapshot | Immutable authoritative answer, source/revision/hash, captured question/guidance, assistance and owner |
| InterviewAssessment | One saved assessment and durable job; input key, config, result, lease and retry state |
| InterviewEvaluatorUsage | Per-invocation model/region, input/output tokens, latency and outcome; no answer content |
| InterviewEvaluatorBudget | Seven-day content-free daily reservation counters; deleting tests cannot reset quotas |

Only source `ADMIN_TEST` with `ADMIN_TYPED`, text revision 1 and no attempt or
recording links is usable. `LIVE_ATTEMPT` and `RECORDING` enum values/link fields
are reserved and blocked by API and database checks until Phase 3 defines same-
owner relations and deletion contracts. They must not become nullable orphans.

Snapshots are immutable in the database. Bank edits/deletion preserve the
captured question and guidance used in old tests. A changed question is shown
in the report; future transcript corrections must create a new snapshot with
explicit supersession, rather than silently overwriting graded text. This is
evaluation provenance, not bank-version authoring.

Deleting the test/owner cascades its answer, job and result. Content-free usage
retains only an anonymized, unlinked invocation record. Deleting a bank question
clears its link, without destroying test evidence. Worker completion rechecks
existence, lease token, current role and feature grant before writing a result.

Input keys include owner/source, question content and revision hash, answer
hash, complete model/prompt/schema/rubric/policy configuration, language,
assistance and text source/revision. Reordered JSON keys do not change a hash.

Pilot caps: 20 reservations/Admin/day, 100 globally/day (UTC), 8,000 answer
characters, 60,000 question-snapshot characters, 2 concurrent leases, 2,000
maximum output tokens, 20-second request timeout, 60-second lease, at most 3
invocations/test. Auto/manual retries consume additional daily reservations.
Transient timeout/unavailability gets bounded backoff; access/invalid-output
failures require review. Expired leases fail explicitly and can be manually
retried within the bound. SDK retries are disabled to avoid uncounted calls.
Old configurations cannot be retried after their code changes; submit anew.
Failed tests offer **Use saved answer in a new test**, which copies the answer,
model and assistance into the form. Submission captures current bank guidance
and configuration; the original failed test and its immutable snapshot remain.

Each two-second worker tick first reads the feature's hidden/disabled state.
Missing, hidden or disabled flags return before opening a job transaction or
calling the model. Claims recheck the flag transactionally, and completion still
rechecks current owner access. Seven-day budget retention is a separate hourly
task per API process, including when the pilot is off; overlapping cleanup is
prevented and today's quotas are never reset.

Input/output-token usage and latency are visible. Dollar cost is deliberately
unconfigured; no pricing assumption is presented as measured cost. A crash
after invocation but before persistence can leave usage unknown; the expired
lease is failed instead of claiming a result or exactly-once billing.
The additive `20261012110000_interview_evaluator_unknown_usage` migration makes
missing provider token telemetry nullable; reports distinguish unknown usage
from reported totals. The earlier locally applied migration is preserved.

## Validation and calibration status

Unit/DB checks cover evidence, schemas, injection boundaries, config/hash
stability, grants/demotion, deduplication, leases/concurrency, quota deletion,
retries/timeouts, deletion races, bank changes and actual topic switching.
Rendering checks cover escaped evidence, uncertainties, generated proposals
and unavailable-topic fallback. Clean install and upgrade migrations pass.
Final regression results: 472 server tests and 210 web tests pass; web/server
builds and typechecks pass. ESLint has zero errors and the existing Replay
dependency warning. One existing Replay test failed intermittently, then passed
its focused recheck and the final full suite. Fresh and upgraded database schema
diffs are empty. No new test dependencies were installed.

Browser checks verify editor → Test answer, queued → completed processing,
exact evidence, duplicate submission with unchanged quota, and a real topic
switch from Python annotations to framework choice. The preview API's earlier
AWS credentials were different from the verified local credentials. It was
restarted with verified credentials in memory; no `.env` files were edited.

The opt-in runner `apps/server/scripts/calibrate-interview-evaluator.ts` uses the
same gate/quota/snapshot/job path as Admin. Its eight synthetic fixtures cover
Python, Frontend, Data Engineering, Manual Testing, Scrum and Data Science at
Simple/Medium difficulty. Both models matched all eight development labels
with validated evidence, including the abstention topic switch. Nova 2 Lite
invocation latency was 1.75–3.13s; Nova Pro was 2.37–3.90s in this small run.
These are measured model-call durations, not live end-to-end latency promises.

The first output-instruction draft exposed unsupported empty-evidence findings;
the stricter format example/evidence instructions fixed the tested cases. This
does not prove broad reliability. Results remain `calibrated: false`.

The real SM-NEW-061 hybrid-retrospective sample exposed the same missing-evidence
failure outside those eight synthetic cases: Nova returned DEPTH/NOT_MET with
empty evidence. Prompt `interview-answer-4` / schema `interview-result-2` make
the omission distinction explicit and enforce the safe downgrade described
above. They also distinguish vague/missing detail from misconceptions, preserve
the spelling of quotes, keep optional depth optional, and require follow-ups
that fit the actual answer. The exact user-provided answer completed through
the local Admin UI in 3.5s with PARTIAL, exact evidence, no misconceptions and
a relevant clarification question. The original failed test was preserved.
Regression checks cover the empty-evidence response, strict rejection of
invented quotes/unsupported positive or accuracy findings, stored validation
notes, and new-test deduplication across configurations. No database migration
or environment-file change was needed. This remains a pilot, not a claim of
expert calibration or broad model reliability.

Before live grading, obtain independent expert labels and held-out cases across
tracks/difficulties, inspect criterion/follow-up disagreements and incomplete
rubrics, and verify repeatability. Extend tests to valid alternatives, hint/
example-assisted answers, uncertainty, adversarial input and Complex/Very
Complex questions. Then implement Phase 3 capture/ownership, thinking pauses/
turn stitching, adaptive session policy, a 5–8 second voice feedback budget and
background reuse, reports and “Ask this session”. Keep technical accuracy out
of Progress Pulse unless a later product decision explicitly changes that.

## Merge handoff and Phase 3 gates

The dormant internal follow-up router and bank worker are unregistered in this
release. Existing queue/service integration tests remain; Phase 3 must review
the real producer before exposing the handoff behind a default-off flag.
Worker regression tests cover the disabled/hidden/missing flag, transactional
recheck, hourly-only cleanup, duplicate starts and cleanup overlap.

Opus's supplied read-only production precheck reports 1,649 items with one draft
each, no published or multi-version items and no recorded rights. This supports
lossless consolidation for that inspected state, not for arbitrary later data.
The deploy owner should repeat the precheck and take a database backup directly
before merge/deploy. No production action is performed by this review.

Before learner access, require recorded provenance/rights confirmation when
activating (including bulk activation), and explicitly decide SUPER_ADMIN vs
ADMIN for activation. Recommended initial policy: Admin authoring/review, Super
Admin activation, with current roles read from the database. Approval and AI
authorship alone do not confirm rights. Keep the one-copy editing workflow.
See [Phase 3 implementation checkpoints](INTERVIEWS-PHASE-3.md).
