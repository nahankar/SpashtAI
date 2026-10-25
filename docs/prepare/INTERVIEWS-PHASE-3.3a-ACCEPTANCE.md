# Phase 3.3a — Acceptance report

Branch `codex/interviews-phase3.3a-acceptance`, from `main` `3b80305` (25 October 2026).
Local verification only: nothing was pushed to `main`, deployed, or enabled in production.

## Verdict

| Area | Status |
| --- | --- |
| Saved-answer transport, idempotency, leases, accounting, access fencing | **Accepted.** Audit defects fixed; PostgreSQL, HTTP-simulation and real-path pilot evidence below. |
| Policy/version strategy for pinned runs | **Accepted.** Frozen registry; Finish can no longer fail on policy drift. |
| Grading quality | **Provisional.** `learner-evaluation-2` agreed with 15 of 17 completed cases (9 of 9 held-out) on small AI-labelled sets. The real-path pilot (Polly-synthesized speech through real Transcribe) found one misheard term graded as a knowledge gap ("get dissect" for git bisect); other mis-transcriptions were not penalised. `learner-evaluation-3` addresses it but is **not yet measured**. |
| Human microphone test | **Not done.** All voice evidence used synthesized speech. |

Recommendation: keep learner evaluation default-off in production. 3.3b work that does not speak
technical feedback (coordinator states, patient endpointing, shared Finish lock) can start. Spoken
feedback from assessments should wait for the `learner-evaluation-3` measurement and a human run.

Evidence labels used below: **I** implemented, **S** tested with simulations (unit, PostgreSQL,
local HTTP Bedrock simulation), **A** tested with real AWS (Bedrock, Transcribe, Polly),
**H** tested by a human. Nothing in this report is **H**.

## Commits

| Commit | Content |
| --- | --- |
| `0fd347d` | Pre-registered reviewed calibration set (20 cases) and Admin-path harness metrics |
| `3dbb42a` | Policy registry, fail-safe Finish, distinct cancel codes, claim-time ledger, content-free failure reasons, `learner-evaluation-2` (registered), Admin learner-policy preview |
| `8faaf7f` | Pre-registered held-out set (11 cases, 9 tracks) |
| `0e42588` | `learner-evaluation-2` keeps the first allowed quotes/list items instead of rejecting the grade |
| `5cc6142` | New evaluated runs pin `learner-evaluation-2` |
| `02eaac5` | `learner-evaluation-3` registered (misheard technical terms), pre-registered `asr-1` cases |

## Audit of the implemented path

Four independent review lenses (transport, grading machinery, versioning, report/privacy) each had
every finding challenged by a separate skeptic; 16 of 17 findings survived. A second adversarial
review of the fix diff found 18 further issues, all fixed in `3dbb42a` before the `learner-evaluation-2`
batches. (Both reviews ran as session workflows; their transcripts are not stored in the repository.)
The baseline batch ran on the pre-fix code of `0fd347d`, which is why its failures were bare
`INVALID_OUTPUT`. Material items:

| Finding | Severity | Resolution |
| --- | --- | --- |
| Any change to the evaluator config made `enqueueLearnerAssessment` throw inside `finishAnswer`, rolling back the saved answer for every already-pinned run; queued jobs were cancelled as `PILOT_ACCESS_UNAVAILABLE` | Major | Frozen `LEARNER_POLICIES`; unknown/altered/config-less policy → answer commits, assessment `CANCELLED EVALUATOR_POLICY_UNAVAILABLE`, no budget. **I S** |
| Prompt text not tied to its version ID | Minor | `PROMPTS` registry; sha256 frozen in tests. **I S** |
| Lost publication transaction left no usage row | Minor | `STARTED` ledger row at claim; lease expiry/cancellation close it as unknown usage; a late finish records actual usage. **I S A** |
| Lease-expiry sweep could overwrite a just-completed grade | Minor | Learner sweep uses a locked, re-checked `UPDATE … RETURNING`. Sequential expiry is tested; the commit-during-sweep race itself is not. The Admin-test sweep keeps its original `updateMany`. **I** |
| Unused follow-up field could fail a learner grade | Minor | Ignored for learner schema `interview-result-3`. **I S A** |
| No classification/criteria consistency | Minor | Learner schema rejects contradictions (`INVALID_OUTPUT_INCONSISTENT`). **I S**; every real-AWS v2 grade passed the check, so no rejection has been observed. |
| Bare `INVALID_OUTPUT` hid the cause | Minor | Content-free `INVALID_OUTPUT_JSON` / `INVALID_OUTPUT_SCHEMA_<field>_<code>` / stop reasons. **I S A** — re-running baseline failure R1-02 under v2 recorded `INVALID_OUTPUT_SCHEMA_criteria_evidence_too_big`. The baseline's own cause is inferred; R1-19 is still undiagnosed. |
| "I don't know" billed a model call | Minor | Deterministic, free under `learner-evaluation-2`. **I S A** |
| Abstention regex was exponential on repeated filler | Major (review) | Disjoint alternatives and a 160-character cap; adversarial input < 1 ms. **I S** |
| Open answers in evaluated runs reported `NOT_ENABLED` | Minor | `AWAITING_ANSWER`. **I S** |
| Transcript-hidden accounts still see Q/A text on the live practice page | Minor, pre-existing | **Not changed**: the live page must show the question. Needs a product decision. |

## Version strategy

See [the implementation contract](./INTERVIEWS-PHASE-3.3a-IMPLEMENTATION.md#policy-versions-and-pinned-runs-acceptance-checkpoint).
A run pins `{ version, config }`; every job runs with that exact registered entry. `learner-evaluation-1`
hashes to the config pinned before the registry existed (`a0c031d3…`), so earlier pinned runs keep their
behaviour. Policies are never edited once a run can pin them; `learner-evaluation-2` was refined once
(`0e42588`) before any learner run pinned it.

## Calibration

**Method.** Real Nova 2 Lite (`us.amazon.nova-2-lite-v1:0`, us-east-1) through the normal accounted Admin
test path (`enqueueAssessment` → worker → usage ledger). Learner policies were run as Admin previews,
which use the learner policy's exact config. Caps were not raised: one Admin's 20 tests/UTC day bounded
each batch. Labels, acceptable alternatives and evidence anchors were committed before each run
(`0fd347d`, `8faaf7f`, `02eaac5`). Labels are mine (AI), checked against bank guidance — not an
independent expert review. Full results: [`calibration/3.3a-calibration-results.json`](./calibration/3.3a-calibration-results.json).

Sets: **reviewed-1** (20 development cases, 8 questions: Automation Testing Simple/Medium, Agentic AI,
Business Analysis) and **heldout-1** (11 cases, 10 questions not used to design the v2 prompt, across
Python, DevOps, Manual Testing, Scrum, Data Engineering, Java, Web, Agentic AI and Automation Testing
Complex). Categories: concise and alternative correct answers, partial, central error, fluent-but-false,
explicit and near abstention, spelling/transcript style, optional-depth omission, prompt injection,
mixed answer with a false secondary claim.

| Run | Cases | Completed | Agrees with label (of completed) | Invalid output | Other |
| --- | --- | --- | --- | --- | --- |
| Baseline (`learner-evaluation-1` prompt) — dev | 20 | 18 | 15 / 18 | 2 (undiagnosed at the time) | Injection case marked a true statement NOT_MET and invented a misconception |
| `learner-evaluation-2` — held-out | 11 | 9 | **9 / 9** | 0 | 2 interrupted by host sleep (below) |
| `learner-evaluation-2` — dev re-run | 9 | 8 | 6 / 8 | 1 (`criteria_evidence_too_big`, fixed in `0e42588`, not re-run) | R1-19 not run (daily cap) |

Exact quotations: every persisted quote was a substring of the answer (validator-enforced; no
`UNSUPPORTED_EVIDENCE` failures observed in 35 completed grades). No case was graded into a forbidden
class; both prompt-injection cases were graded on their technical content only under v2.

Remaining v2 disagreements (development set):
- R1-03 (transcript-style correct answer, AUT-002): PARTIAL, and lists "don't mix waits" as missing although
  the answer says "dont mix implict and explict". A genuine model error.
- R1-15 (Awaitility polling, AUT-NEW-060): PARTIAL. The answer does not describe backoff, which the bank lists as
  Core, so my CORRECT label was probably generous; kept as pre-registered. The grade also contains a model error:
  it lists "Diagnostic logging not explained" although the answer says "I log the last response I saw". Its
  transient-versus-terminal gap is ambiguous because the bank lists that concept under both Core and Optional depth.

**Latency and usage** (latency is server-measured wall-clock time around the Bedrock Converse call, including
response validation; tokens are provider-reported; host-sleep calls excluded):

| | Call latency p50 / p95 / max | Mean tokens in / out |
| --- | --- | --- |
| Baseline (n=20) | 2.68 / 3.30 / 3.37 s | 1,448 / 390 |
| `learner-evaluation-2` (n=17) | 2.62 / 4.86 / 4.86 s | 1,450 / 347 |

Cost: AWS's own price page was not checked. Third-party listings give $0.33 / $2.75 per million input/output
tokens for the US cross-region profile, about **$0.0015 per evaluated answer**. Missing provider usage is stored
as unknown, never zero.

Host sleep: three v2 calls overlapped macOS sleep periods in the `pmset` log (279 s and 948 s "Maintenance
Sleep" for H1-02 and H1-11; 939 s "Sleep Service Back to Sleep" for R1-05). They recorded `TIMEOUT`
and `LEASE_EXPIRED` with unknown tokens — a real exercise of the lease/ledger path, not a provider failure.
One of them recovered on retry (R1-05, PARTIAL as labelled).

**Bank guidance errors found during labelling** (not edited; approvals and provenance untouched):
- AUT-002 credits "Selenium Manager-backed condition waits"; Selenium Manager resolves binaries, not waits.
- Several "Misconceptions: … Correction: …" lines do not correct their misconception (AUT-002, AUT-NEW-016,
  DE-NEW-012, DEV-NEW-080).
- AUT-NEW-060 and OPS-NEW-001 list the same concept under Core and Optional depth.
- AAI-NEW-006 lists serving guidance as an "acceptable alternative"; its example calls the definition a limitation.
- Templated `expectedDepth` text asks candidates to "identify why the stated misconception is false"; v2 treats this as optional.
- DEV-NEW-080 (REST resource design) is filed under the Java track.

## Real-path learner pilot

**Method.** Local stack from this branch: web, API with the learner worker, LiveKit, the running interview agent,
AWS Transcribe/Polly and Bedrock. An identified local test learner (`interview-pilot-learner@spasht.test`) was
granted `interview_adaptive` through the Admin feature-flag API. Playwright drove Chrome for Testing through the
normal Interviews UI; answers were Polly-synthesized speech fed through an injected WebAudio microphone and
saved with the app's own Finish, Skip, Next, End and Discard controls. **A**, not **H**.

| Check | v1 run | v2 run |
| --- | --- | --- |
| Microphone answer → Finish → exactly one LIVE_ATTEMPT assessment | ✅ | ✅ |
| Double-clicked Finish → one snapshot, one assessment, one billed call | ✅ | ✅ |
| Reload mid-practice → auto-reconnect, no duplicate snapshot/assessment/billing | ✅ | ✅ |
| Skip → no snapshot, no grade; playback Skipped marker | ✅ | ✅ |
| "I don't know" → NOT_ANSWERED | ✅ (billed) | ✅ (no model call) |
| 3-second thinking pause stitched into one saved answer | ✅ (3 chunks) | ✅ (3 chunks) |
| End clicked while the job was PENDING → evaluation completed during the End sequence (before the server recorded the run ended) and shows in playback | ✅ | — |
| Discard while the provider call was RUNNING → run deleted, nothing published; ledger keeps actual tokens, unlinked | ✅ | — |
| Grant revoked while RUNNING → `CANCELLED PILOT_ACCESS_UNAVAILABLE`, answer kept, usage recorded | ✅ | — |
| No ProgressPulse rows, no points, `progressPulseStatus=skipped` | ✅ | ✅ |
| Recording and playback with findings, grouped answers, audio player | ✅ | ✅ |

Each ended interview session still receives a `SessionMetrics` row from the existing delivery-alignment worker
used by playback. Keeping it out of communication aggregates relies on the `purpose='COMMUNICATION'` filters in
metrics, coach, Progress Pulse and analytics code — established by code reading and existing tests (**I S**), not
by the pilot. No evaluator code writes `SessionMetrics`.

Across all pilot runs, 19 answers were saved, each with exactly one assessment job — no duplicates. The discarded
run's answer and assessment were deleted with it (its usage row was kept, unlinked), leaving 18 of each in the database.

Measured on the real path: Finish → saved 8.36–8.44 s for every logged save (drain, receipt and finish); queue →
completed 2.7–5.9 s (call latency 2.0–4.5 s); Finish → findings ≈ 11–14 s. The save barrier returned
`TRANSCRIPT_PENDING` once in 20 Finish actions, after a 3-second thinking pause; "Retry saving speech" is the
intended recovery.

Findings:
- **A misheard technical term was graded against the learner (one occurrence).** Transcribe produced "get dissect" for git bisect;
  `learner-evaluation-2` marked accuracy PARTIAL with the gap "misstated … indicating a lack of familiarity".
  "dome" (DOM) and "Right assertions" (write) were not penalised in other answers. `learner-evaluation-3` adds
  explicit misheard-term guidance; `asr-1` (5 pre-registered cases, including one that must stay INCORRECT)
  will measure v2 against v3.
- A page reload loses that segment's in-browser recording; playback states "One recording segment has no audio"
  and keeps the other recordings and all saved answers. Pre-existing behaviour.
- Ending a practice and navigating away immediately can interrupt the leave sequence (recording upload, segment
  close, run end); the run then stays open until the learner resumes or ends it. Pre-existing.
- Synthesized speech is cleaner than real speech; real accents, noise and disfluencies are untested.

## Tests

| Suite | Result |
| --- | --- |
| Server (unit + PostgreSQL on `simple_bank`) | 600 passed, 4 skipped (HTTP simulation) |
| HTTP Bedrock simulation cases (Postman local, `INTERVIEW_EVALUATOR_TEST_ENDPOINT`) | 4/4 passed under v1 and v2 |
| Web | 273 passed |
| Typecheck (server, web, calibration script); lint of changed web files | clean |

`shared-replay-evidence.test.ts` failed once under full-suite load and passed 3/3 alone and on the next full
run; treated as an existing timing flake.

## Unresolved and next steps

1. Run on the next Admin budget (20, UTC day): `asr-1` under v2 and v3 (10), H1-02 and H1-11 (interrupted by
   sleep), R1-02 (overlong-quote fix) and R1-19 (not run). Adopt `learner-evaluation-3` only if it removes the
   misheard-term penalty without excusing real false claims.
2. A human microphone run with an identified tester (Interviews, Interview voice, Interview technical
   evaluation granted; a new practice). Include an accent and natural thinking pauses.
3. An independent human review of a sample of labels and grades, particularly PARTIAL versus CORRECT on Medium
   questions, before any wider pilot.
4. Fix the bank guidance errors above through the normal editor (no versioning change).
5. Product decision on transcript-hidden accounts during live practice.
6. Larger calibration needs either more UTC days or an explicitly approved additional Admin tester; caps were not
   raised here.
