# Phase 3.3c — Human-pilot grading findings, Interview history and inline feedback (plan)

Branch: `codex/interviews-phase3.3c-history-feedback`, based on `codex/interviews-phase3.3b-coordinator`
(which already contains `main`). Not merged or deployed. Grade-dependent adaptation and generated
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
