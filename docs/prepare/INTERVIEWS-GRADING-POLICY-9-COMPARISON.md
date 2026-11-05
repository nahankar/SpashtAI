# Policy 9 comparison — 6 November 2026

**Decision: HOLD.** Policy 9 improved the measured grading checks, but it is not ready for learner promotion
or score-driven adaptive selection. Policy 8 remains current. Nothing merged, deployed or enabled.

## Scope and provenance

Tested application revision: **`a2f9286`** on `codex/interview-grading-policy-9`. Policy 9, its parser and the
two fixtures were unchanged during the comparison. Same Nova 2 Lite model, temperature, token cap and timeout.
No prompt tuning, label edits, retries or extra identities after inspecting outputs.

The owner approved up to 36 additional real-model calls after the earlier 20-call baseline exhausted the
normal Admin allowance. Exactly **36** additional invocations ran through the saved Admin assessment/worker
path on isolated local database `spasht_grading_validation`, using restricted role `walkthrough_app`:

- 20 policy-9 regression calls, plus two free deterministic request/abstention controls.
- Eight policy-9 fresh-answer calls.
- Eight policy-8 fresh-answer calls.

The isolated Node processes temporarily used an Admin ceiling of 56 (20 prior + 36 approved). The global cap
remained 100. Final persisted Admin and global usage were 56. No budget was reset. A fresh process confirmed
the normal application Admin limit is still 20 and CURRENT is still `learner-evaluation-8`. The benchmark
processes have exited. No production services, settings or data were touched.

Additional calls: 34 successful outputs and two consistency rejections; no provider failures. Recorded usage:
**51,070 input and 12,183 output tokens**, none unknown. This is usage, not a monetary cost estimate.

## Results

“All checks” includes classification, evidence and declared semantic requirements; unavailable results fail
acceptance but are not relabelled as incorrect answers. Counts include the two free controls in regression.

| Set / metric | Policy 8 | Policy 9 |
| --- | --- | --- |
| Regression: all checks pass | 14/22 | **19/22** |
| Regression: usable completed grade | **21/22** | 20/22 |
| Regression: original acceptable classification | **20/22** | 19/22 |
| Regression: exact preferred classification | 18/22 | **19/22** |
| Fresh answers: all checks pass | 4/8 | **8/8** |
| Fresh answers: usable grade and exact classification | 8/8 | 8/8 |

The earlier saved v8 regression run is the baseline; it was not rerun as a simultaneous repeat. The fresh
eight answers were evaluated once on each policy. These results do not establish repeated-run stability.

| Model latency | p50 | p95 | Maximum |
| --- | --- | --- | --- |
| v8 regression (earlier baseline) | 2.477 s | 3.184 s | 7.669 s |
| v9 regression | 2.519 s | 3.611 s | 3.785 s |
| v8 fresh | 2.529 s | 4.475 s | 4.475 s |
| v9 fresh | 2.529 s | 4.106 s | 4.106 s |

Small samples do not justify a general latency improvement claim. No adaptive selection or voice round-trip
latency was measured here.

## Improvements observed

- RS-01: the false causal explanation is now INCORRECT, without REASONING MET.
- RS-05: implicit valid reasoning is credited.
- RS-06: the empty justification now completes as NOT_ANSWERED, instead of inconsistent output.
- P2-06: the mixed answer is PARTIAL and its correct composition concept is retained in strengths.
- P2-07: implicit reasoning is credited without the prohibited “no reasoning” feedback.
- H1-10: the secondary misconception is identified while preserving PARTIAL.
- Fresh cases F9-01/03/04/07: v8 returned the expected overall classifications but missed valid reasoning;
  v9 credits it. Both policies matched preferred classification on all eight fresh cases.

These are observed outcomes for the frozen cases, not claims that the underlying defect is universally fixed.

## Remaining blockers and regressions

1. **RS-03:** a correct implicit-mechanism answer that v8 graded CORRECT now fails with
   `INVALID_OUTPUT_INCONSISTENT`. There is no usable v9 grade.
2. **H1-11:** a correct package-versus-monorepo trade-off answer that v8 graded CORRECT now fails with the
   same code. Availability regressed: two rejected model outputs, versus one on the baseline set.
3. **P2-08:** the substantive but vague fragmented answer is still classified NOT_ANSWERED. The declared
   acceptable labels are PARTIAL/INCORRECT. The candidate therefore still risks interpreting missing clarity
   as missing knowledge and choosing an unjustified topic switch.

The consistency rejection prevented publication of an invalid result; it does not make the case a pass.
The saved error is content-free and does not identify which candidate guard failed. Rejected provider text
is not retained. We cannot infer a particular coverage/depth/claim conflict from that aggregate code, and
we did not make unapproved calls to reconstruct it.

## Evidence and reproduction

Committed JSON under `calibration/`:

- `2026-11-06-policy-9-regression.json` and `...-review.json`.
- `2026-11-06-policy-9-fresh.json` and `...-review.json`.
- `2026-11-06-policy-8-fresh.json` and `...-review.json`.
- `2026-11-06-policy-9-comparison.json`: authorization/budget provenance, fixture hashes and paired baseline
  comparison. Original v8 baseline files remain unchanged.

Each new case reports `reused: false`. No cached assessment was counted as a fresh invocation. Model, prompt,
policy and question revisions are preserved in the raw reports. No credentials, authentication state or audio
are committed. Private launchers/logs remain under `/private/tmp/spasht-grading-validation/`.

Offline review, from repository root (exit 1 is expected for the regression HOLD):

```sh
node --import tsx apps/server/scripts/review-interview-calibration.ts \
  apps/server/test/fixtures/interview-calibration-readiness-2026-11-06.json \
  docs/prepare/calibration/2026-11-06-policy-9-regression.json /private/tmp/policy-9-regression-review.json

node --import tsx apps/server/scripts/review-interview-calibration.ts \
  apps/server/test/fixtures/interview-calibration-policy-9-fresh-1.json \
  docs/prepare/calibration/2026-11-06-policy-9-fresh.json /private/tmp/policy-9-fresh-review.json
```

Structural checks on the tested code already passed: 646 server tests, with 290 optional/database tests skipped,
and the server build. This comparison changed evidence/docs only, so those checks were not unnecessarily rerun.
No new microphone scenario or database integration suite was run. Saved typed answers isolate grading quality.

## Next work

Keep policy 9 as an unpromoted experiment. A further candidate needs precise, content-free diagnostic reasons
for rejected claim results, then evidence-supported correction of those conflicts and substantive/no-answer
judgment. Preserve every frozen version and failed case; use a new version for changed semantics. Do not relax
guards merely to turn rejected outputs into passes or add question-specific exceptions for P2-08.

After further model tests fit a normal or separately approved budget, repeat critical cases to measure stability.
Expected labels remain AI-reviewed against the bank, not independent domain-expert calibration; fresh answers
use previously reviewed question domains. Independent review and integrated learner/voice/workspace checks
remain prerequisites for promotion. Selector plumbing can proceed with grade-driven steering off, using neutral
fallbacks for unavailable or untrusted grades. Generated follow-ups and adaptive production enablement remain off.
