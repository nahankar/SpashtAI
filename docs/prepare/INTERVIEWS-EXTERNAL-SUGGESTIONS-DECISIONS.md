# Decisions on the two external AI reviews — 9 November 2026

Both reviews were based on the engineering brief, not source access. Recommendations below were checked
against the current preview branch `codex/interview-grading-policy-13` at `3e44849`, its measured results,
the Interview capture/selection paths and current AWS documentation. This is a design decision record;
no new evaluator, model call, schema migration, production change or release enablement is implied.

## Constraints and present implementation

Use Amazon-authored models through AWS Bedrock. Nova 2 Lite remains the experimental baseline; no OpenAI,
Anthropic or other third-party model is introduced, including third-party models hosted on Bedrock. Existing
voice backend options are not changed by this assessment. Proposed model/ASR experiments stay local, bounded,
versioned and separately measured before any promotion. Policy 8 remains current; adaptive release is HOLD.

Source confirms:

- `evaluator/service.ts:adaptiveDecision` is the old Admin test proposal path. Non-switch actions can return
  generated, review-required follow-ups. `finishAssessment` explicitly stores `next: null` for learner previews.
  The current learner `practice/service.ts` selects approved bank questions by eligibility, prior exposure and
  deterministic run/question ordering, not the most recent grade. The proposed classifier routing is therefore
  a future learner dependency, not a production controller already making these mistakes.
- Policies 9–12 ALREADY extract claim judgments and derive classification in server code. Their failures include
  semantic claim/scope/coverage mistakes and repeated-input disagreement. Recommending that architecture as a
  novel stability fix overlooks measured history.
- The bank already has track/category/topic, difficulty, tags, approval, expectedDepth, goodAnswerPoints and
  followUpGuidance. It does not have reviewed essential-objective IDs, reasoningRequired or a bank question-family
  graph. `InterviewAttempt` already records parent/follow-up history and prevents repeated bank question IDs
  within a run. Reuse existing concepts before proposing new components or migrations.
- `expectedDepth` defaults to “Explain your reasoning and give a practical example.” That generic guidance is
  not evidence that every question actually requires either. A reviewed question requirement is a useful
  addition; inferring a universal requirement from this default would preserve the current over-demanding bias.
- The Interview capture path forwards final transcript text/timing through `interview_voice.py` and commits
  text chunks. Its frozen answer snapshot has transcript-integrity events, not recognition-confidence spans.
  The separate Elevate word-evidence collector is not an Interview confidence feed.
- `evaluator/learner.ts` already withholds grading for confirmed gaps, unresolved recognition unavailability or
  accepted unconfirmed speech through `practice/integrity.ts`. Missing speech is not deliberately graded as ignorance.
- The Bedrock evaluator does not send `additionalModelRequestFields.reasoningConfig`; extended thinking is
  disabled by default. No conclusion about its value has been established in our benchmark.

## Adopt now / next bounded implementation

1. **Separate core knowledge from reasoning and presentation.** Preserve the compact policy-13 checkpoint.
   Design a new preview rather than modify it. A malformed feedback paragraph must not change a valid core
   decision (already implemented). A valid FALSE_CORE decision must not be discarded solely because a separate
   reasoning field points at a false statement. Do not credit that as valid reasoning; report it separately as
   not met, unassessed or conflicting under an explicit new contract. If the core evidence itself conflicts,
   keep the grade withheld. Never silently turn FALSE_CORE into COMPLETE or repair uncertain core truth.

   R1-08 is the direct regression: the model selected FALSE_CORE with incorrect references `[1,2]`, no correct
   references, but reasoning `[2]`. A new contract must distinguish attempted reasoning from valid reasoning.
   Retaining a primary verdict does not mean the whole assessment is suitable for adaptive routing; conflict
   and availability must be independently visible. Do not inflate “usable for adaptation” by counting fallback
   or provisional feedback as a full pass.

2. **Keep assessment separate from the next-question policy.** Before any live adaptive path, implement/test a
   small deterministic policy that accepts explicit assessment availability, learner control events and known
   transcript integrity. REVIEW, invalid output, incomplete capture and pending assessment cannot update a
   knowledge state or trigger difficulty reduction/topic switching. Repeat/skip/pause must retain their actual
   intent. Use a bounded same-topic clarification/retry or the existing neutral bank sequence; never guess a
   knowledge deficit. No immediate five-service Learning State redesign is needed.

3. **Review requirements on a small pilot bank.** Explicitly record which essentials and explanations the
   question asks for, using stable IDs if coverage mapping is introduced. Treat unknown requirements as unknown,
   not a global true/false default inferred from boilerplate. Start with a reviewed pilot, snapshot/version it,
   and test import/backward compatibility before any broad schema rollout. This can clarify rubric semantics
   but cannot make an LLM's claim-to-requirement matching intrinsically true or repeatable.

4. **Measure ASR provenance and vocabulary before gating.** A separate voice task should retain available
   provider word-confidence with provider/language/transcript revision provenance, while preserving the raw
   original transcript. Missing confidence stays unknown; never manufacture 1.0. Investigate a curated
   Transcribe custom vocabulary for actual technical-term errors. Compare vocabulary on/off on the same audio
   with real browser/microphone scenarios. Preserve actual wrong-answer controls so vocabulary cannot earn
   technical credit or overwrite the learner's meaning. No vocabulary resource or AWS setting is created here.

5. **Strengthen the benchmark by failure category and routing effect.** Continue frozen, owner-accepted AI-led
   labels without claiming independent validation. Add fresh cases and review disagreements explicitly. Report
   model-only grade availability, false technical credit, false penalties, ambiguous-answer disposition,
   reasoning correctness, feedback correctness and resulting actions separately. Exclude free controls from
   model accuracy. Repeat critical cases and report denominators/uncertainty; do not turn proposed 95%/98%
   targets into claims from a tiny sample. Broader technical domains and real spoken sequences remain required.

## Useful direction, defer until the primary assessor is measured

- Bank-linked misconception repair/application questions: valuable, but first curate actual approved follow-up
  families. Do not introduce REPAIR/DIAGNOSE action names without eligible reviewed questions and fallback rules.
- Concept-level history: if needed later, use stable bank concept IDs and an append-only evidence/action audit,
  not LLM-written free-text mastery lists. Counters alone also do not establish mastery, and uncertain results
  must not update demonstrated-knowledge counters. Reuse current run/attempt history first.
- A second assessor, three-call voting or fine-tuning: experimental options, not current fixes. Same-model errors
  are correlated; majority agreement is not truth. Claim alignment across paraphrases is itself an unsolved
  input to claim-level voting. Measure against adjudicated references and budget before adopting another call.
- Model comparison: use the same frozen answers, requirements and validators. Record semantic outcomes,
  availability, repeat/routing stability, tokens (including reasoning), latency and actual access restrictions.
  Existing `amazon.nova-pro-v1:0` comparison support is Amazon Nova Pro, not proof of Nova 2 Pro account access.
  Do not copy the review's preview pricing ratios, availability or timelines into an implementation estimate.

## Reject or correct specific claims

- **“Deterministic aggregation guarantees repeatability.”** Only the function is deterministic for identical
  structured inputs. The model can change truth, core status, coverage or essential IDs; the final outcome can
  still change. Policies 9–12 provide counterexamples. This is not fixed by moving one `if` into another file.
- **“A confidence threshold fixes ASR.”** Transcribe's confidence is optional recognition evidence, not technical
  correctness. A low score can occur on a correct term; a wrong term can still receive high confidence. Choose
  thresholds from representative labelled audio and examine false REVIEW rates. No arbitrary 0.80 production
  gate; an average can conceal a low-confidence negation or one important technical word.
- **“Every core false claim must dominate.”** That can erase meaningful correct core knowledge in mixed answers
  and conflicts with existing P2-06 adjudication. Use an explicitly reviewed mixed-answer policy, not a universal
  any-false-wins rule. Conversely, a tautology or incidental true detail must not rescue a false core distinction.
- **“Any instruction echo makes the whole answer empty.”** That erases genuine technical content beside an
  embedded prompt injection. Ignore grading instructions while assessing the actual subject claim; retain the
  existing substantive-answer-plus-injection regression. Short lexical matching is not a truth detector.
- **“Boolean reasoningObserved fixes the problem.”** Observation alone does not establish a valid explanation.
  Record attempted/valid/invalid/unassessed distinctly when needed, with evidence, and keep requirements tied
  to the reviewed question. A false explanation must not earn valid-reasoning credit.
- **“Any existing character offset proves evidence.”** A range can be in bounds without supporting the paraphrase.
  Policy 13 already guarantees copied source passages; entailment/truth still requires semantic validation.
- The reviews' week estimates, model-price multipliers and broad guarantees are unverified proposals. No such
  delivery date, quality guarantee or model-switch cost has been accepted.

## AWS documentation checked

- [Transcribe streaming Item](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_streaming_Item.html):
  word/phrase confidence is optional; larger values indicate greater recognition confidence. It is not a
  subject-knowledge assessment and may be absent.
- [Custom vocabularies](https://docs.aws.amazon.com/transcribe/latest/dg/custom-vocabulary.html): intended for
  domain-specific words; same-region vocabulary and appropriate language/format are required. Use curated
  technical terms and test rather than assume accuracy improvements on all answers.
- [Nova 2 Lite model capabilities](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html):
  client-side tool calling supported, native structured outputs unsupported, extended thinking optional/off by default.
- [Extended thinking](https://docs.aws.amazon.com/nova/latest/nova2-userguide/extended-thinking.html): compatible
  with tool use and bills reasoning tokens. A bounded LOW-effort same-model comparison is worth preparing;
  it has not been run. Keep a separately pinned config and explicit token/time/call ceilings. Do not enable
  HIGH effort, remove bounds, auto-increase tokens/retry, or expose hidden reasoning content to users/logs.
- [Nova tool troubleshooting](https://docs.aws.amazon.com/nova/latest/nova2-userguide/troubleshooting.html):
  concise/shallow schemas and clear argument definitions are recommended. This supports the compact contract,
  but our real-provider failures remain the acceptance evidence.

## Next checkpoint and authorization boundaries

Next: prepare a small, versioned core-versus-reasoning contract change and regression tests; preserve all
policy-13 results and labels. In parallel as design work, specify neutral handling of unavailable/uncertain
assessment before live adaptation. Do not rebuild claim extraction, Learning State or the entire bank as a
prerequisite to learning whether the primary defect improves.

Before more model calls, reconcile the current UTC-day quota; the normal 9 November allowance was already
used by policy 13. Do not reset usage or reuse yesterday's bounded allowance. A new paid batch or expanded
reasoning budget needs a concrete bounded plan within available authorization. No new call was made for
this review. Any future voice-path implementation needs the existing candidate tool and isolated stack checks.
No merge, deployment, learner-policy promotion or adaptive production release is approved by these reviews.
