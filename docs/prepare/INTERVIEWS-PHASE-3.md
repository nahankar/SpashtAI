# Phase 3 — Hidden adaptive interview practice pilot

Simplified Phase 2a and the Admin evaluator are deployed through `d283857`.
Phase 3 implementation is local on `codex/interviews-phase3`; deployment is a
separate review step. Keep one editable bank copy; past attempts retain
their captured question, answer and assessment. Technical feedback stays
outside Progress Pulse. Start with Automation Testing unless the user chooses
another pilot track.

## Changes from the reviewed plan

- Production now has all 1,649 `automation-pilot` questions approved and active.
  Preserve those states. Add provenance confirmation as a separate single/bulk
  action; missing confirmation excludes a question from learner selection.
  CSV import cannot confirm provenance. One confirmation note can cover a
  reviewed selection, avoiding another workbook-enrichment cycle.
- Proceed with the recommended initial activation policy: current SUPER_ADMIN
  activates; ADMIN edits, approves and confirms provenance.
- Existing LiveKit token/dispatch and session lifecycle routes are gated on
  Elevate. Add purpose-aware authorization before wiring the interview adapter;
  learner Interviews access must not depend on the Elevate navigation flag.
  Keep token parameters exactly room/sessionId/segmentId.
- Live assessment access and budgets must be separate from the Admin evaluator
  flag/caps. The worker must select enabled sources, rather than an off Admin
  flag blocking learner jobs or an on learner flag permitting Admin tests.
- The authoritative answer will be the server-assembled committed answer chunks
  captured for the attempt, with source/revision/hash recorded. Silence does
  not finalize an answer. Later transcript/recording alignment cannot silently
  change an already graded snapshot; correction uses explicit supersession.
- Persist generated question wording and matching evaluation guidance before
  asking it. The current bank-guided follow-up proposal alone does not establish
  a complete rubric for a newly generated or harder question.
- Start with standalone practice and namespace `automation-pilot`, excluding
  old workbook copies and QA/generated namespaces. Journey launch/context is a
  later adapter integration; quick runs do not carry cross-session context.

## Checkpoint 3.0 implementation

Added an additive local migration for explicit provenance note/time/actor. It
does not change existing approvals or active states. Single and bulk Admin UI
confirmation require a deliberate checkbox and authorship/permission note.
Edits and changed CSV imports invalidate confirmation; a database trigger also
clears it on content changes outside those handlers. Identical imports and
approval/activation changes preserve confirmation. Deleting the confirmer
clears the actor link while retaining the recorded note/time.

Activation reads the current Super Admin role under a database lock, independent
of JWT role claims. Learner eligibility requires approval, activation, spoken
suitability and confirmed provenance. Existing Admin evaluator tests remain
usable for unconfirmed bank drafts. No production migration or flag change is
part of this local checkpoint.

Verification: 476 server tests pass in the serialized shared-DB run, 210 web
tests pass, typechecks/builds pass, and the changed UI files have no lint errors
or warnings. The default parallel run exposed the existing intermittent Replay
workflow assertion; evaluator fixture flags now keep legacy enabled in sync.
Clean installation and preview/test upgrades pass. Browser QA uses only two
newly authored disposable questions in `phase3-ui-qa`: activation requires
confirmation, and bulk confirmation preserves active/draft states. Imported
content was not automatically attested. Bank integration tests now refuse the
preview database and use only the disposable `simple_bank` database.

## Checkpoint 3.0 — Learning-content and access gates

- Require recorded provenance/rights confirmation when activating questions,
  including bulk activation. Preserve existing drafts and approvals; do not
  assume imported source answers are learner content or invent rights claims.
  Existing active rows without confirmation must remain ineligible for the
  learner pilot until confirmed.
- Decide SUPER_ADMIN vs ADMIN for activation. Recommended starting policy:
  Admin edits/reviews; Super Admin activates, enforced using current DB roles.
  Keep ordinary editing and the single-copy bank simple.
- Use the existing hidden/default-off Interviews flag and selected-user grants.
  Learner question selection requires approved, active, spoken-suitable and
  provenance-confirmed content. Return only learner-safe fields.
- Independently review a small varied pilot set and held-out correct, partial,
  incorrect, abstention, alternative-answer and adversarial examples. Confirm
  criteria and adaptive follow-ups, not just classification or fluent output.
- Keep interview history/context separate from standalone communication
  history, Coach communication context, Pulse and points. Quick practice has
  within-session context; cross-session learning context belongs to a journey.

## Checkpoint 3.1 — Persist attempts and authoritative answers

- Add owned interview run/attempt records linked to existing Session/segments,
  the actual asked question, its bank or generated origin, parent attempt,
  topic/difficulty and assistance. Store generated questions before asking
  them; a bank match must not replace the actual wording in a past report.
- Capture an immutable question/guidance snapshot per attempt. Decide whether
  committed transcript text is the grading authority and define revisions and
  supersession when it changes. Live provisional judgments must identify their
  input and remain separate from the final persisted assessment.
- Enable LIVE_ATTEMPT only with a required same-owner attempt link and complete
  deletion/discard behavior in both DB and API. Leave RECORDING blocked until
  its ownership and consent contract is implemented. Do not simply remove the
  Phase 2b source constraints or let learners submit ADMIN_TEST.
- Keep exactly one logical assessment for the same immutable input/config.
  Use additive migrations, test fresh/upgrade paths and preserve old tests.

## Checkpoint 3.2 — Simple learner launch using the existing voice engine

- Add a hidden Interview Practice entry with track, experience, starting
  difficulty and duration. Reuse the extracted live-session engine rather
  than duplicating Elevate's room, microphone, reconnect and pause handling.
- Let the server create the INTERVIEW-purpose session and appropriate context
  scope. Journey links and purpose must agree atomically. No learner-controlled
  parameters may turn interview results into communication/Pulse activity.
- Select from eligible bank questions, avoid repetition within the run, and
  handle sparse track/difficulty coverage honestly. Keep history and retention
  classification interview-aware from the first session, including abandoned
  sessions handled by the inactivity worker.
- Test pause/resume, refresh/reconnect, discard and recording consent. Capture
  thinking pauses and stitch answers spanning speech turns without ending an
  attempt on the first short silence. Ask one question at a time.

## Checkpoint 3.3 — Adaptive interview loop

- Strong answer: deepen the demonstrated concept or move to a harder eligible
  question. Partial answer: probe one actual gap. Incorrect answer: simplify
  a prerequisite. Explicit lack of knowledge: move to another topic. Use bounded
  follow-ups, time limits and coverage rules so one topic cannot consume a run.
- Generated questions are allowed and must fit the track, competency and
  experience. A variant that changes the concept requires matching evaluation
  guidance; do not blindly apply its parent's answer key. A bank follow-up is
  guidance, not a script to repeat after the user has addressed it.
- Use subject accuracy independently of existing communication feedback.
  Spelling, accent, fluency and missing optional depth must not lower subject
  findings. Mark hint/example-assisted responses explicitly.
- Measure end-to-end latency. Use a 5–8 second live-feedback budget with a
  truthful pending-report fallback. Do not invent a correctness verdict after
  timeout/invalid output or raise difficulty on that basis. The background
  report reuses the same saved result when the authoritative input matches.
- Keep live execution and quotas separate from the ADMIN-only evaluator pilot;
  define learner access, limits and cancellation before enabling it.

## Checkpoint 3.4 — Post-session report and Ask this session

- Show each actual question and answer, evidence-based subject findings,
  improvement guidance, assistance and pending/failed status. Show communication
  feedback separately. No numeric subject score or Pulse write is required.
- Ask this session must resolve the requested question/attempt, explain the
  right approach with examples, and distinguish bank learning content from an
  AI-generated explanation. Admit ambiguity in questionable bank guidance;
  never expose private evaluator instructions or unrelated user sessions.
- Keep independent-answer and after-example retries distinguishable. Prove
  user/account deletion, session discard and retention behavior for transcripts,
  snapshots, jobs and reports.

## Checkpoint 3.5 — Optional growth of the shared bank

- After the interview ends, enrich only follow-ups that were actually asked.
  Remove candidate/company details and reject questions that cannot be made
  generic safely. Persist source/provenance without retaining private answers
  in shared bank content.
- Review the producer and then register the reserved internal endpoint and
  worker behind their own default-off flag, gated on both enqueue and execution.
  Internal authentication alone is not a rollout gate.
- Preserve idempotency, deduplication and discard/deletion fencing. New questions
  arrive inactive/unapproved and require provenance confirmation and Admin
  review before activation. No automatic learner publication.

Ship each checkpoint as a reviewable commit and verify the complete hidden
pilot before widening access. Bank enrichment can follow the usable interview
loop and report; it need not delay the first pilot. Navigation expansion and
journey integration can follow the standalone pilot once the session contract
is proven.
