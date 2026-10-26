# Phase 3.3b follow-up — Human-pilot grading findings, Interview history and inline feedback

**This is not Phase 3.3c.** It is the grading, history and playback follow-up to 3.3b. Bank-first adaptive
difficulty and grounded generated follow-ups (3.3c in `INTERVIEWS-PHASE-3.3.md`) have **not** been started.
The branch name `codex/interviews-phase3.3c-history-feedback` predates this correction; the branch content is
the 3.3b follow-up only. It is based on `codex/interviews-phase3.3b-coordinator` (which already contains
`main`). Not merged or deployed. Grade-dependent adaptation and generated
follow-ups stay deferred until grading acceptance; Interviews stay outside Progress Pulse.

## 1. Grading findings (regression source: local session `session_1792914992205_vcdezwozx`, run pinned to `learner-evaluation-3`)

| Q | Saved answer | v3 outcome | Finding |
| --- | --- | --- | --- |
| 1 | "Because its container changes without a viewport resize." | PARTIAL; REASONING "does not provide reasoning" | The answer *is* a reason. Credit it; optional elaboration may be suggested, not listed as a missing core point. |
| 2 | Four fragments: "…centralizes transport setup. / Without mutable. / cross test. / Leakage" | PARTIAL; "single statement" | Consider every fragment; acknowledge supported concepts (mutable, cross-test leakage) without inventing an explanation. |
| 5 | "Can you repeat that question one more time, please?" | NOT_ANSWERED ("Does not know") | Request only: no assessable evidence, must not imply a knowledge deficit. |
| 6 | "Let's skip this question and move to the next one." | NOT_ANSWERED | Same as Q5. |
| 7 | "I don't know." | Deterministic abstention | Distinct case; keep. |

Design:
- **New policy `learner-evaluation-4`** (prompt `interview-answer-7`, schema `interview-result-3`, rubric
  `bank-guidance-2`). Existing policies are frozen; runs pinned to v1–v3 keep their behaviour and stored
  assessments are never rewritten. Adopted as CURRENT only after measurement.
- **Request-only answers (deterministic, v4 only).** A whole-answer check, anchored at both ends and
  length-capped, recognises answers that consist only of requests to repeat, skip, pause or move on
  (with filler/courtesy words). It never matches inside a longer technical answer; anything else goes to
  the model. Outcome is server-authored: classification `NOT_ANSWERED` (unchanged schema), plus a
  server-owned `responseKind: 'REQUEST_ONLY'` and neutral guidance pointing to the Repeat/Skip buttons.
  Explicit "I don't know" gets `responseKind: 'DONT_KNOW'`. No spoken command is executed.
- **Prompt `interview-answer-7`** = v6 plus rules: a stated cause/condition ("because…", "so that…",
  "when…") is reasoning and must be quoted under REASONING; never say reasoning is absent when the answer
  states why; optional elaboration goes to guidance, not gaps; a transcript may split one answer into
  fragments — consider every fragment, acknowledge concepts they convey, never call a multi-fragment answer
  a single statement, never credit an explanation the learner did not give; a request to repeat/skip
  embedded in a technical answer is not evidence either way.
- **Labels.** `NOT_ANSWERED` displays as "No technical answer"; `responseKind` refines it to
  "Request only · no answer to assess" or "Did not know". Historical rows without `responseKind` keep
  their stored meaning.
- **Practice UI.** One line: spoken requests (repeat, skip, pause) are not supported yet; use the buttons.
- **Measurement.** Fixture `interview-calibration-pilot-1` (regression cases above plus embedded-command
  and earlier regression cases), run on v3 and v4 through the accounted Admin preview path before adoption.

## 2. Interview history screen

Reuse: `SessionFilters` (search, status filter, sort), Elevate's history card layout, `RetainCheckbox`,
`interviewHistoryPath`, existing `GET /api/interviews/runs` (owner-scoped, discarded excluded).
- API: extend the history rows with `answeredCount`, `skippedCount`, `incompleteCount` (no new endpoint).
- Route `/interviews/history` (`InterviewHistory` page) linked from the Interviews landing page; the inline
  landing list becomes a short "recent" list with a "View all" link (no duplicate list infrastructure:
  both use one `InterviewHistoryList` component).
- Rows: tracks, date/time, status (In progress / Ended), answered and skipped counts; search by track;
  filter by status; sort by date or question count.
- Resume for unfinished practices (existing retention and access rules); Review opens playback directly
  (`/interviews/playback/:sessionId`, "All" already the interview default).
- Loading, empty, no-match and error-with-retry states.

## 3. Inline technical feedback in playback

- Server: playback messages carry `attemptId` (already embedded in message ids; add the field).
- Web: `InterviewFeedbackDisclosure` renders below each learner answer, keyed by `attemptId` from the
  existing assessments endpoint (one fetch, polled only while pending). Collapsed by default; summary
  "Technical feedback · Partially correct"; body shows strengths, missing core concepts, misconceptions,
  uncertainty and guidance; honest pending/unavailable/failed states.
- Skipped and incomplete questions keep their position and light-orange badge, with no grade.
  Request-only and "I don't know" show their own summary.
- The separate large findings section is removed from playback (live practice keeps its compact list).
- Native `<details>`/`<summary>` disclosure: accessible, no focus stealing; content arriving or expanding
  does not touch audio state or scroll position.

## 4. Verification

Unit and DB tests for request-only/embedded/abstention distinctions, policy registry and history counts;
web tests for history filters/Resume/Review, feedback association by attempt id (skips, out-of-order
completion) and playback stability; calibration on real Bedrock for v3 vs v4. Grading and UI changes in
separate commits.

## Results (25 Oct 2026, local)

Grading (real Bedrock through the accounted Admin preview path; small pre-registered set, not a calibration
claim; evidence in `docs/prepare/calibration/3.3c-calibration-results.json`):

| Policy | pilot-1 classification | Pilot-specific checks | Earlier regression subset |
| --- | --- | --- | --- |
| learner-evaluation-3 (pinned baseline) | 8/8 | Q1 reasoning not credited; Q1/Q2 wording ("does not provide reasoning", "single statement"); Q5–Q7 no response kind | — |
| learner-evaluation-4 (prompt rule; measured, not adopted) | 8/8 | Q2 fixed, Q5–Q7 kinds correct; **Q1 still unreasoned** | 12/12 |
| learner-evaluation-5 (adopted for new evaluated runs) | 8/8 | all pass (reasoning credited from `statedReasons`, fragments acknowledged, request/don't-know kinds) | 12/12 |

No invalid outputs; v5 model latency p50 2.38–2.64 s, p95 2.59–2.82 s. Request-only and "I don't know"
answers are deterministic (no model call, no budget). Historical assessments are unchanged; their
NOT_ANSWERED label now reads "No technical answer".

UI (local browser, test learner): history shows counts, search/no-match, Review opens playback with All;
playback shows one collapsed disclosure per answer keyed by attempt id, the skipped question keeps its badge,
the old findings section is gone; expanding feedback during playback kept audio playing (27.96 → 29.72 s),
scroll unchanged and focus on the play button; no horizontal overflow at 390 px; no page errors.

## Acceptance pass (26 Oct 2026)

**Reasoning judged by meaning** (fixture `reasoning-1`, pre-registered; real Bedrock, accounted Admin preview):

| Case | v3 | v5 (current) | v6 (measured, not adopted) |
| --- | --- | --- | --- |
| False reason with "because" (RS-01, RS-04) | not credited | **RS-01 credited as MET** | not credited |
| Empty "because it is better / good practice" (RS-02, RS-06) | both evaluations failed (inconsistent output) | RS-02 correct; **RS-06 evaluation failed** | both correct |
| Valid reasoning without causal words (RS-03, RS-05) | not credited; says "no reasoning" | not credited; no false wording | not credited; **says "no reasoning"** |
| Classification agreement | 4/6 | 5/6 | 6/6 (and 8/8 pilot-1, 12/12 regression) |

`learner-evaluation-6` (prompt `interview-answer-9`) treats extracted passages as candidates and stops
over-crediting, but then credits no reasoning at all and re-introduces the pilot Q1 wording. It is registered
(stored previews stay valid) but **not adopted**; `learner-evaluation-5` remains current. Iteration stopped
here by agreement: the REASONING criterion is not yet reliable in either direction (**open blocker**).
Classification is stable across v5/v6 on every set.

**Inline feedback space.** Every answer shows a same-height "Technical feedback · Loading…" line until
findings arrive; it becomes the summary, "Not enabled for this practice", "Skipped · not evaluated" (speech
saved before a Skip), "Incomplete answer · not evaluated" or "Could not load". Measured with the assessments
response delayed 3 s: page height and the last answer's position unchanged (0 px) with evaluation on and off.

## Open before merge or deployment

1. **REASONING reliability** (above): decide between another measured prompt iteration, or not surfacing the
   REASONING criterion to learners until it passes `reasoning-1` and `pilot-1` together.
2. **Human microphone practice on v5** through History → Review (the v3 regression session keeps its stored
   feedback by design).
3. **D-1 recording loss on refresh** remains open (saved answers and transcripts unaffected).
4. Expert review of grades remains an acceptance requirement.

Roadmap status: 3.3a done locally; 3.3b and this follow-up done locally on review branches; **3.3c (adaptive
difficulty, generated follow-ups) and the rest of 3.3d not started.**

## Second human v5 practice (26 Oct 2026, run `cmvot1shp000l8p4vuw0v654x`)

Handled as intended: v5 pinned; one evaluation per answer; "Can you repeat that question?" → request only;
"I don't know." → did not know; skipped question ungraded; empty "…because." not credited; history 7 answered
/ 1 skipped; one segment with a complete 261 s recording.

UI follow-up (commit 04db037): the practice/results page now shows the same collapsed feedback under each
saved answer (the separate section is removed), and question cards no longer show the bank's expected-depth
authoring text (removed from the learner API; evaluators keep it in the snapshot). Verified on this saved
session on both the practice page and History → Review.

Grading reproductions (pre-registered fixture `pilot-2`, exact saved answers; Q1/Q2 are controls):

| Case | v5 (current) | v7 (measured, not adopted) |
| --- | --- | --- |
| Q6 correct "composition rather than nested futures" beside a false "use synchronous calls" | INCORRECT; correct concept not acknowledged | same |
| Q7 implicit reason "positive tabindex creates a competing manual order" | PARTIAL; reasoning not credited, says "no reasoning" | PARTIAL; not credited, false wording gone |
| Q8 vague but substantive fragments | NOT_ANSWERED | NOT_ANSWERED |
| Q1/Q2 controls (instruction echo, empty "because") | NOT_ANSWERED | NOT_ANSWERED |

v7 (prompt `interview-answer-10`, built on v5 with balanced reasoning rules, whole-answer and
no-technical-answer definitions) kept 26/26 classifications on earlier sets and stopped writing false
"no reasoning" wording, but re-credited a false "because" reason (RS-01), credited no implicit reasoning and
left Q6/Q8 unchanged. Three prompt revisions (v4, v6, v7) on Nova 2 Lite have moved wording, not judgement.

**Unresolved (merge blockers):** REASONING judgement (both directions); acknowledging correct concepts in
mixed answers (Q6); vague-but-substantive vs no technical answer (Q8). Options, none started: measure a
stronger model (the registered Nova Pro comparison configuration) on the same 31 cases; or stop surfacing
REASONING findings and gap text about reasoning to learners until the sets pass. Recording loss on refresh
(D-1) remains open.

## Model benchmark: Nova Pro vs Nova 2 Lite (26 Oct 2026)

Same frozen, pre-registered cases (pilot-2 incl. human Q6/Q7/Q8 and controls, reasoning-1, pilot-1, asr-1,
reviewed-1 and heldout-1 subsets: 36 cases) through the accounted Admin path. Three configurations: current
v5 on Nova 2 Lite; v5's exact prompt/schema/rubric on Nova Pro (`learner-evaluation-5-nova-pro`, preview only,
isolates the model); and the existing `nova_pro` comparison, which uses the older Admin prompt. Evidence:
`docs/prepare/calibration/3.3b-followup-model-benchmark.json`.

| Measure | v5 · Nova 2 Lite | v5 prompt · Nova Pro | nova_pro (Admin prompt) |
| --- | --- | --- | --- |
| Invalid outputs | 1 | 3 (human Q6, Q7, Q8: inexact evidence quotes) | 6 |
| Pre-registered outcome met | 34/35 | 31/33 | 26/30 |
| Implicit reasoning credited (where expected) | 1/4 | 3/3 of those completed | 1/3 |
| False/empty reason not credited as MET | 3/4 | 5/5, but credits empty "because" as PARTIAL (RS-02, RS-06, P2-02) | 5/5 |
| Controls stay "no technical answer" (P2-01, P2-02) | 2/2 | 0/2 (both PARTIAL) | 0/1 (+1 invalid) |
| Correct concept beside a false claim (Q6) | not acknowledged | invalid output | acknowledged |
| Request-only / don't-know kinds | 3/3 | 3/3 | 0/3 (no deterministic path) |
| Misheard-term tolerance (asr-1, no misheard gap) | 4/4 | 3/4 | 2/3 |
| Unexpected misconceptions | 0 | 2 | 3 |
| Model latency p50 / p95 | 2.38 / 2.82 s | 3.31 / 3.80 s | 3.31 / 4.83 s |
| Tokens in / out (whole batch) | 62.1k / 11.4k | 62.0k / 11.4k | 51.6k / 12.3k |

Reading: Nova Pro credits implicit reasoning better, but on the human fragmented answers it fails to return
valid evidence quotes, it upgrades instruction echoes and empty justifications to PARTIAL, it is less tolerant
of misheard terms and ~40% slower. The configured `nova_pro` is worse still and lacks the learner rules. The
comparison **does not support a model change**. It supports keeping technical grading **experimental** (pilot
flag, clearly labelled) while targeted work continues; the next candidate fixes are structural rather than
prompt rewrites (for example, investigating why multi-line answers produce inexact quotes, which affects Nova
Pro most, and an explicit model-free check for instruction-echo/empty-justification answers). Hiding the
REASONING finding would only be a presentation safeguard: it would not fix Q6 or Q8 and is not acceptance.
