# Adaptive next-question selection — implementation assessment

Date: 5 November 2026. Status: proposed implementation scope; no application changes or production enablement.

Baseline inspected: locally available `origin/main` at `810a65b`. Fetch and reconcile the implementation baseline before starting code; this is not a verification of the current EC2 revision.

Workspace Prepare and AI Coach remain parked in [the product backlog](../GENERIC-BACKLOG.md).

## What exists and what is missing

| Area | Verified behavior at this baseline | Work remaining |
| --- | --- | --- |
| Selection | `practice/service.ts:prepareBankAttempt` selects unused, learner-eligible bank questions within the run's saved track, experience and starting-difficulty selections. Recent exposure and a deterministic hash decide order. | Consume the previous committed answer's valid assessment when choosing the next question. |
| Manual and automatic progression | Manual Next and `agentPrepareNext` ultimately use the same bank selector. Conversation mode has its own access/pinned policy. | Use one adaptive selector for both modes; changing selection must not automatically enable conversation mode. |
| Grading | A saved answer can enqueue a durable learner assessment under its pinned evaluation policy. Current policy is `learner-evaluation-8` (Nova 2 Lite); comments and calibration evidence still label technical grading experimental. | Reassess grading reliability on strong, partial, incorrect, alternative, mixed and abstention answers before using grades to steer a pilot. Do not change models or rewrite existing policy entries as part of selection work. |
| Existing adaptive helper | `evaluator/service.ts:adaptiveDecision` is an Admin preview suggestion. Its generated text lacks a complete new rubric and its bank selection lacks the full learner eligibility/experience rules. | Do not use it unchanged as live selection authority. |
| Durable adaptation | No `InterviewDecision` model or adaptation policy snapshot exists. Attempt snapshots exist, but SQL currently permits BANK origin and no parent only. | Add a small durable decision record and immutable launch-time selection policy; generated attempts are a separate release. |
| Feedback | Learner assessment API returns `AFTER_PRACTICE` with no result before End. | Preserve this API and UI boundary while the server privately uses assessment results. |

The older [Phase 3.3 design](INTERVIEWS-PHASE-3.3.md) remains useful background, but its immediate spoken technical feedback and universal eight-attempt limit are superseded for this work. New runs currently have `maxQuestions=null`, plan-based durations and an optional no-time-limit setting. Preserve those choices and historical run limits.

## Recommended first release: reviewed-bank adaptation

### Earlier Phase 3 work to close first

- **Grading acceptance:** reasoning judgments, mixed correct/incorrect answers and substantive-versus-no-answer classification remain documented weaknesses of the current policy. Re-run held-out cases against current code and obtain domain review of expected outcomes before enabling grade-driven steering. Do not hide a weak criterion and assume the underlying classification is reliable.
- **D-1 recording recovery:** `origin/codex/interviews-reliability-d1` at `8564bd0` contains `74d763d` (recoverable local recording journal). At inspected `origin/main` `810a65b`, that commit is not an ancestor and the journal/recovery files are absent. Reconcile and port the required recovery work onto current main; do not merge an old branch wholesale. Verify workspace/account binding, logout cleanup, refresh/crash recovery, pause/resume, interrupted upload and no duplicate/foreign recording attachment with the automated voice tool.
- **Current baseline acceptance:** reverify complete-answer capture, transcript-gap grading suppression, feedback only after End, manual Finish/Skip/Next, and recording/playback on the final integrated revision. Historical passing runs are evidence for their tested revisions, not a substitute for this integration check.

Selector/schema development and deterministic tests can proceed while these are closed. They are enablement gates, not a reason to bundle unrelated product work. Automatic conversation can remain off while bank adaptation is first exercised through manual Next.

Adapt the next bank question without generating new question text or new grading guidance. This provides a smaller, auditable first step and reuses the existing recorder, voice pipeline, answer capture, evaluator and player.

Proposed behavior (pilot defaults, to be fixed in the versioned policy before implementation):

| Previous answer | Next step |
| --- | --- |
| Valid, confident CORRECT | Prefer a deeper question on the same topic, or one difficulty step harder within the learner's allowed difficulty range. |
| Valid PARTIAL | Prefer a reviewed question that probes the relevant missing concept on that topic. If bank metadata cannot establish a meaningful match, continue neutrally. |
| Valid INCORRECT | Prefer a relevant prerequisite or one step easier, within the allowed range. Do not assert a knowledge gap aloud. |
| Explicit don't know | Move to a different eligible topic; avoid trapping the learner in repeated probes. |
| Skip / control-only request | No grade-driven adaptation. Respect the control; Skip moves on neutrally. |
| Pending, failed, uncertain, invalid or integrity-incomplete assessment; quota exhausted | Select a neutral eligible bank question. Missing evidence never means an incorrect answer. |

Every candidate must retain namespace, track, experience, verbal suitability, approval, activation, provenance, same-run repetition prevention and workspace constraints. Apply topic matching and difficulty ordering deterministically. Inspect bank topic/concept coverage first: a matching topic label alone does not prove a targeted probe exists.

Keep difficulty inside the range the learner authorized. If the current UI's difficulty selection is interpreted only as a starting point, add an explicit adaptive range; do not silently widen a learner's selection. A one-level-only selection can still adapt topic/question depth without leaving that level.

Bound consecutive same-topic probes (proposed default: one) and prefer variety. If a targeted candidate is unavailable, prefer an unused same-level eligible question on another topic, then an eligible simpler question inside the allowed range, then normal bank-exhaustion completion. Never widen track/experience or use unapproved material to keep a run alive.

## Implementation sequence

### 1. Policy and grading evidence

- Reconcile the historical calibration files and open semantic failures with the current evaluator and reviewed bank. Use held-out answers with independently recorded expected outcomes; structural JSON validity alone is not grading quality.
- Explicitly test instruction echoes, legitimate alternative answers, mixed good/bad reasoning, missing transcripts, retries and abstention. Record unsafe steering separately from ordinary wording differences.
- Add a default-off selection capability distinct from the existing `interview_adaptive` evaluation flag (proposed identifier: `interview_question_adaptation`). Validate workspace/member access as well as platform access. A flag alone must not change existing runs.
- Pin a versioned selection policy at run creation, separately from evaluation and conversation policy. Include allowed difficulty range, probe bound and fallback deadline. Legacy runs keep current behavior.

### 2. Server selector and durable decision

- Extract shared eligible-bank selection from `prepareBankAttempt`; keep current behavior as the legacy/neutral path. Add `practice/adaptation.ts` for pure policy decisions and candidate ranking.
- Add an append-only/consumption-fenced decision record unique to a source attempt: run, source snapshot/assessment identity, policy version, action, reason code, requested/selected difficulty and selected next attempt. No raw answer text in logs/analytics.
- Preserve the existing Session/Run locking and stale-advance/idempotency rules. Concurrent manual Next, coordinator Next and retries must prepare the same next attempt, with at most one open attempt.
- Read one existing assessment job; never invoke the evaluator twice for live progression and the final report. No provider call or polling delay inside a database transaction.
- Use a bounded asynchronous wait only if needed (proposed maximum: five seconds from the next-question request, measured and configurable). If it expires, commit a neutral decision. A late grade may appear after End but must never replace an already selected question or change the decision.
- End/discard, membership suspension, feature revocation and session/segment changes must fence preparation and speech. If selection is disabled, safe Finish/Skip/End/history stay available and further selection uses the neutral path when Interview execution remains allowed.
- Keep attempt origin BANK in this release. Do not loosen generated-origin constraints or add a generation worker yet.

### 3. Integration and validation

- Wire manual and conversation modes through the same selector. Do not enable automatic progression globally as a side effect.
- Before End, show only question, transcript and truthful selection/waiting state; no technical verdict, model answer, private rubric or decision rationale that reveals the grade. After End, explain the question sequence and available feedback without exposing internal model material.
- Test policy outcomes, sparse banks, all allowed difficulty boundaries, concurrent/duplicate Next, late assessments, budget exhaustion, suspension, End/discard and old runs. Include initialization/upgrade migration checks and restricted-role tests with two organizations plus Personal.
- Extend automated voice scenarios to verify the expected question transitions using fictional reviewed questions and actual spoken answers. Add dedicated scenarios/fixtures if the generic candidate cannot prove adaptive selection; do not treat a generic voice PASS as adaptation acceptance.
- Run final manual and conversation scenarios on a verified isolated stack with the current voice tool, including hesitation/silence and transcript-integrity cases. Inspect saved decisions, transcript, recording/playback, late-result behavior and API/agent logs. Report exact revisions and evidence.
- Measure answer-save, evaluator availability/wait, selection and first spoken audio separately. Five seconds is a proposed wait bound, not an end-to-end latency guarantee.

## Later release: generated follow-ups

Only after reviewed-bank adaptation and grading acceptance: generate a question-specific package with expected concepts, alternatives, misconceptions, depth and answer guidance; validate it; persist provenance, same-run parent and immutable package before speech; account for generation/retries; enforce deadlines and neutral bank fallback. Generated content must never be silently published to the shared bank. This needs its own schema/migration and held-out grading validation.

## Completion and release boundary

The next implementation should deliver the reviewed-bank slice, its tests and measured evidence for review. No production flag, model, question-bank publication or deployment is authorized by this plan. Prepare/Coach and unrelated voice reliability investigations remain separate. Grading reliability is a release gate for grade-driven steering, not a reason to delay pure selector, idempotency and isolation tests.

## Recording prerequisite checkpoint (5 November, local only)

The workspace-safe D-1 port is now on `codex/interviews-recording-recovery-workspaces`: `942956e` adds the journal,
original-workspace reauthorization and account isolation; `feaaa71` checks the exact durable speech receipt if a
LiveKit acknowledgment is lost. Neither is merged or deployed. See that branch's
`docs/prepare/INTERVIEWS-RECORDING-RECOVERY.md` and validation report for current test/voice evidence and release gates.
Production browser persistence remains off by default pending recording-notice review; this does not close the
production prerequisite merely because a local implementation exists. Grading acceptance and adaptive selection
remain separate, unfinished work.
