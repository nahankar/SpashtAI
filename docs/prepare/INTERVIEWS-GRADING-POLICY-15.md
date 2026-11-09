# Interpretation-first grading preview 15 — 9 November 2026

**Completed the approved 20-call real-model run on `b265cf01d2b56fdaedcf833e59db335e3d0e3ad5`.
HOLD adaptive Interviews.** Active learner grading stays `learner-evaluation-8`. No production changes,
migration, question selection or learner-state updates were made. This branch builds on the measured OFF/LOW
comparison reported in `INTERVIEWS-GRADING-THINKING-COMPARISON.md`.

## Finding and narrow hypothesis

With the same inputs and 15,000-token/40-second limits, LOW improved the ASR and mixed-answer cases,
but both modes missed implicit reasoning. Neither safely abstained on uncertain speech; LOW changed
that case from INCORRECT to NOT_ANSWERED on repeat. A valid schema and exact passage references did not
make those judgments true. The unwired router cannot recover uncertainty the evaluator never declares.

Policy 14 permits absent reasoning fields and an optional REVIEW path. That allows an omitted check to
look identical to a deliberate unassessed explanation. The next preview requires explicit interpretation
and reasoning fields. This prevents silent omission and enforces **declared** uncertainty. It does not
prove the model will detect ambiguous meaning or correctly identify implicit reasoning.

Earlier policies 11/12 already tried detailed interpretation ledgers and failed many format/consistency
checks. This is not a newly discovered general solution: it is a smaller, bounded experiment retaining
policy 14's source-passage evidence and separate knowledge/reasoning guards. If it fails, retain the
counterexamples; do not keep adding phrase-specific rules or relabeling them until they pass.

## Changed behavior, preview only

Config `learner-evaluation-15`:

- Amazon Bedrock `us.amazon.nova-2-lite-v1:0`, us-east-1, temperature 0, LOW extended thinking.
- Same bounded resource envelope as the preceding comparison: maxTokens 15,000, timeout 40,000 ms,
  one SDK request attempt. No automatic resource/model expansion.
- New prompt `interview-answer-17`, schema `interview-result-9`, unchanged `bank-guidance-6` inputs.
- Config hash `238d93ddbeb32160f55f45c6fb3ca44e6d4c032999d2959973a27377d7afdcde`.
- Prompt SHA256 `511fd6b2c4e78801afe533ae17d0d6cfca9843012cee36ff34a38706b253f53d`.
- Tool schema hash `4dc72576f341210c99d99dfd704b5870c0e4128b8716c811200bfb99587dea21`.

Required `interpretation` contains status CLEAR / NORMALIZED / UNCERTAIN, a short public paraphrase or
specific ambiguity (max 400 characters), and original passage IDs. This is not hidden deliberation or
verified ASR provenance. A normalized technical name requires original evidence and cannot upgrade the
knowledge grade by itself. A clear false assertion remains gradable as incorrect.

After strict shape and passage-reference validation, UNCERTAIN throws the existing nonretryable
`EVALUATION_REVIEW_REQUIRED`, even if the model also submits a contradictory COMPLETE/FALSE_CORE.
No grade is returned. The service's existing review failure path and shadow HOLD apply. Invalid/missing
interpretation or reasoning fields fail closed as invalid output, not a safe semantic review success.

Both `validReasoning` and `invalidReasoning` lists are required, possibly empty. Empty explanation remains
unassessed without lowering otherwise complete knowledge. Malformed lists are invalid output in v9;
v8 retains its historical optional-field behavior. Structurally valid but conflicting reasoning still
retains the separate core verdict with server-owned hold metadata. True/false explanations are never
merged into the knowledge decision. Evidence is copied from source passages, not the public paraphrase.

Prompt 17 asks for meaning before truth judgment, then independent explanation assessment. It distinguishes
recoverable names from unresolved relationships, and mechanisms/contrasts across adjacent fragments from
empty causal slogans. Its illustration uses request-local settings, not the failed benchmark answers.
It also keeps questionText ahead of boilerplate depth/examples and forbids spelling penalties after
normalization. These are hypotheses for model testing, not assertions that prompt wording fixes them.

No original prompt/config/schema was edited. The interpretation summary is validated as input only and
is not added to the saved/public grade, evidence quotations or logs. Hidden reasoning blocks remain ignored.

## Frozen test definition — subsequently executed below

Fixtures:

- `apps/server/test/fixtures/interview-calibration-policy-15-focused-1.json`: eight historical paid cases
  with unchanged labels/checks, eight newly authored same-domain cases, two existing free controls.
- `apps/server/test/fixtures/interview-calibration-policy-15-repeat-1.json`: four fresh repeats, P2-08,
  A1-01, N15-03 and N15-06, with unchanged inputs/checks.

The new cases cover a concise fact/dimension answer, clearly false table roles, unresolved referents,
implicit keyboard-order consequences, an empty explanation alongside true knowledge, genuinely wrong
bisect behavior, recoverable DOM transcription wording and mixed stale-element knowledge/reasoning.
The ambiguity case must return no grade. Clear false cases must not be excused as uncertainty. Mixed
knowledge must be preserved, and empty/false reasons must not receive full credit.

These are AI-authored technical expectations accepted under the owner's adjudication instruction,
not independent human/domain-expert validation. At freeze time, the new cases had not been run against this or earlier
model policies; their first results are reported below. They are not independent-domain holdouts; broader domain coverage remains necessary.
The new interpretation illustration is not itself a benchmark answer. Do not change labels after outputs.

The separately approved bounded run cost **20 paid calls**: 16 initial plus four fresh repeats, including
one initial canary. Two controls are free. Freeze tested revision/config; verify the isolated database,
restricted role and question revisions; stop on configuration/access/prerequisite/token-limit errors.
Persist first-trial results before owned fictional snapshot replacement. Verify repeats have new IDs,
reused=false and identical answer/question/config/input hashes. No counter reset or new quota identity.
Retries consume the same bound and displace planned cases. The maximum configured generation allowance
is 300,000 tokens; actual input/output usage and latency must be reported, no speculative dollar estimate.

The preceding comparison used its 20-call allowance (actor/global day usage reached 60). The owner then
explicitly approved a separate 20-call allowance for this run; usage reached 80. Both allowances are now
fully consumed. No further paid calls are authorized by either allowance. Source limits stay 20/admin/day
and 100/global/day; production is unchanged.

Acceptance: report usable grades, invalid output, safe ungraded review, accepted and preferred grades,
semantic/evidence/feedback checks, held-core results, repeated dispositions/shadow actions, latency and
usage separately. Wrong-but-stable labels do not pass. Neither generic failures nor indiscriminate review
count as correct uncertainty handling. Do not publish a general reliability claim from this small set.

## Preparation validation (before the real-model run)

- 133 focused tests passed, including the new interpretation gate, original-passage evidence, missing
  mandatory fields, false reasoning, normalization without upgrade, and old-policy compatibility.
- Full server suite, serial: **736 passed, 290 optional/database tests skipped**. First sandboxed run
  could not bind test HTTP listeners; rerun with socket permission passed. No provider errors were fixed
  by changing application behavior or weakening tests.
- Server TypeScript build passed.
- Actual AWS SDK HTTP to the owned loopback fixture: **25 assertions passed**, including new v9 uncertainty
  plus a contradictory COMPLETE, normalized output, missing reasoning and unsupported passage references.
  Request events were inspected. This is authored response/caller-boundary evidence, not real-model grading.
- No real voice scenario: only an inactive Admin grading preview changed. Voice capture, UI, agent, learner
  policy and progression are untouched. Integrated adaptive rollout still requires automated real voice
  and workspace acceptance, alongside broader/fresh semantic validation.

Private evidence: `/private/tmp/spasht-grading-validation/policy-15-focused.log`, `policy-15-build.log`,
`policy-15-server-serial.log`, `policy-15-http-results.json`, `policy-15-simulation.ndjson`.
The owned simulation on 4931 was stopped; shared app/agent/LiveKit/database services were not stopped.
No credentials, authentication state, recordings, hidden reasoning or raw rejected model bodies are committed.

## Reproduce the free checks

From the grading worktree:

```sh
npm --workspace apps/server test -- test/interview-interpretation-first.test.ts test/interview-separated-grading.test.ts test/interview-evaluator.test.ts
npm --workspace apps/server test -- --no-file-parallelism
npm --workspace apps/server run build
postman simulation run postman/simulations/interview-evaluator.sim.yaml --port 4931 --no-history --output ndjson
```

Run the owned fixture in its own terminal, preserve its output in an ignored private directory, then:

```sh
env NODE_ENV=test INTERVIEW_EVALUATOR_TEST_ENDPOINT=http://127.0.0.1:4931/bedrock \
  node --import tsx apps/server/scripts/check-interview-evaluator-simulation.ts /private/tmp/policy-15-http-results.json
```

Stop only that owned fixture afterward. Do not use the calibration script against the real provider until
the new allowance and isolated target are established. No merge, deployment or adaptive enablement is requested.


## Observed real-model results

All 20 invocations used AWS Bedrock Amazon Nova 2 Lite with LOW thinking, 15,000 maximum output tokens,
40-second timeout and no retry. The tested application tree was clean at `b265cf0`; no code, prompt,
fixture, rubric, validator, resource limit or expected label changed during the run. The canary was R1-08
and is included in the initial 16 paid cases. Two free deterministic controls are excluded below.

| Measure | Initial paid cases | Fresh repeats |
| --- | ---: | ---: |
| Cases / real invocations | 16 | 4 |
| Structurally usable published grades | 13 | 2 |
| Grade inside accepted band | 11 | 2 |
| Preferred grade label | 9 | 2 |
| Expected uncertain cases correctly ungraded | 1/2 | 1/2 |
| All frozen semantic/evidence/feedback checks pass | 12/16 | 3/4 |
| All checks AND preferred grade/review outcome | 10/16 | 3/4 |
| Invalid-output jobs | 1 | 1 |
| Server-held core grades (assessmentIssues) | 0 | 0 |
| Unexpected ungraded reviews on gradable controls | 1 | 0 |
| Provider/configuration/access failures | 0 | 0 |

Accepted/preferred grade counts exclude ungraded-review successes. Fourteen initial cases expected a
grade, two expected review. A generic schema failure is not correct semantic review, even when both
publish no score. Two deterministic controls passed with no model invocation. Both offline reviewers
exit 1 for HOLD; this is an acceptance result, not a crashed benchmark.

Historical eight: six usable grades, six cases pass all semantic checks, four preferred grades and no
matched review. New eight: seven usable grades, five preferred grades plus one matched review, six cases
pass all checks. New inputs are same-domain AI-authored probes, not independent human validation.

### Per-case observations

| Case | First result | Repeat | Assessment |
| --- | --- | --- | --- |
| R1-08 false core | INCORRECT | Not selected | Pass |
| H1-09 relevant incomplete idea | PARTIAL | Not selected | Pass |
| P2-07 implicit reasoning | CORRECT, reasoning MET | Not selected | All semantic checks pass; preferred PARTIAL/routing differs |
| P2-08 ambiguous speech | Invalid oversized interpretation summary | Review required | No grade both times; only repeat is a valid review outcome |
| A1-01 recoverable ASR | CORRECT | CORRECT | Frozen checks pass twice |
| A1-05 genuinely wrong control | INCORRECT | Not selected | Pass |
| P2-06 mixed knowledge | INCORRECT, correct strength acknowledged | Not selected | Broad accepted band passes, preferred PARTIAL/routing still differs |
| P2-02 instruction echo | Unexpected review required | Not selected | Fail: should be NOT_ANSWERED, not unresolved meaning |
| N15-01 concise fact/dimension distinction | PARTIAL, reasoning unassessed | Not selected | Fail: correct answer penalized for unasked explanation |
| N15-02 clearly false table roles | INCORRECT | Not selected | Pass; no uncertainty escape |
| N15-03 unresolved referents | Review required | Invalid oversized interpretation summary | Only first is a valid review outcome; no grade on either |
| N15-04 implicit keyboard-order consequence | CORRECT, reasoning MET | Not selected | Pass |
| N15-05 empty reason alongside true knowledge | PARTIAL | Not selected | Pass; no full reasoning credit |
| N15-06 clearly wrong bisect behavior | INCORRECT | INCORRECT | Pass twice; no uncertainty escape |
| N15-07 recoverable DOM wording | CORRECT | Not selected | Pass |
| N15-08 mixed stale-element knowledge | INCORRECT, true strengths retained | Not selected | Fail: meaningful correct knowledge still discarded in primary grade |

The two uncertainty trials alternated review-required versus
`INVALID_OUTPUT_SCHEMA_interpretation_summary_too_big`. The content-free transport observer recorded
UNCERTAIN for all four of those initial/repeat responses. This supports a formatting/validation defect:
non-grade-bearing public explanation length blocks the otherwise declared uncertainty path. It does not
justify retroactively counting invalid outputs as valid reviews, increasing the token budget, or claiming
the whole uncertainty classifier is fixed. P2-02 shows a separate false-positive uncertainty error.
No hidden reasoning or rejected provider text was retained, so exact rejected summary text/length is unknown
beyond the parser's over-limit diagnosis.

P2-07's implicit explanation is now credited, but a preferred grade difference remains; it was not repeated.
N15-01 still fails reasoning and coverage: the question asks the fact/dimension distinction, while feedback
requires an additional explanation of how grain prevents incorrect aggregation. The answer already names
measurement grain and descriptive context. This is rubric-overreach/coverage judgment, not a missing token
or parser repair. N15-08 explicitly acknowledges the correct DOM-replacement cause and re-location recovery
in strengths, yet its primary label is INCORRECT rather than the frozen PARTIAL. Raising token/time limits
or fixing summary formatting cannot solve either semantic failure.

### Repeat, transport and cost checks

Four fresh repeat IDs were verified against preserved first-trial snapshots: same answer text/hash,
question hash, input key and per-arm config hash; reused=false. Only A1-01 and N15-06 have stable primary
labels and stable exact dispositions (two of four). The two uncertainty cases are consistently held with
no knowledge update, but their error dispositions are not stable. Do not report four stable grades.

Provider-reported totals across 20 calls: **51,988 input tokens, 19,254 output tokens**. No unknown usage.
Output includes reasoning and final data. Model latency p50 **5,845 ms**, p95 **9,123 ms**, max **9,175 ms**;
this is a small sequential run, not a production latency estimate. LOW was requested and a reasoningContent
block observed in 20/20 responses, with only its presence recorded. No retries/timeouts/max-token failures.
Interpretation statuses were CLEAR 13, NORMALIZED 2, UNCERTAIN 5. No reasoning text or raw response body
is in result/error logs or committed evidence. No dollar-cost estimate is asserted.

The isolated `spasht_grading_validation` database uses `walkthrough_app`, verified neither superuser nor
RLS-bypass. All nine distinct required bank questions were active/approved at pinned revisions. Actor and
global day counters moved **60 -> 80**, matching exactly 20 invocations. No budget reset, new actor or
source/production quota change. The guarded private launcher checked the clean SHA/config/date/database,
then both counters before and after every case. It stopped on provider/config/prerequisite failures;
none occurred. Only this process's actor ceiling was 80; the normal source limits remain 20/admin, 100/global.

### Evidence and launch commands

Private evidence under `/private/tmp/spasht-grading-validation/` (directory mode 700):

- `policy-15-{canary,initial,repeat}.json`, their logs and `policy-15-*-cases/*.json`: normal accounted
  Admin path, separate per-case reports. `policy-15-merged.json` combines canary + initial remainder
  without duplicated canary/reused trials and identifies original source reports.
- `policy-15-{initial,repeat}-review.json`: frozen offline acceptance.
- `policy-15-repeat-audit.json`, `policy-15-repeat-verification.json`: first results retained before
  owner-only deletion of the four fictional snapshots, then exact fresh-repeat input verification.
- `policy-15-{canary,initial,repeat}-transport.ndjson`: request hashes, mode/status enums, source-evidence
  counts, tool count, stop reason, latency and usage only; no paraphrase/hidden reasoning text.
- `policy-15-summary.json`: separate model/control metrics and offline shadow proposals.
- `policy-15-budget-reconciliation.json`: final counters, restricted role and pinned questions.

The private dated launcher ran `canary`, then `initial`, then `repeat` after audited snapshot replacement:

```sh
env DATABASE_URL=postgresql://walkthrough_app@127.0.0.1:55443/spasht_grading_validation \
  POLICY_15_CALLS_APPROVED=20 \
  node --import tsx --env-file=/Users/neelesh.ahankari/Applications/SpashtAI/apps/server/.env \
  /private/tmp/spasht-grading-validation/policy-15-approved.mts canary
```

Do not rerun the exhausted dated allowance. The private launcher invokes the normal calibration script
one frozen case at a time, preserves each report, then checks usage and failure disposition before the next.
It does not bypass the service worker/accounting path. The normal script uses
`--fixture policy-15-focused-1 --model learner-evaluation-15 --only CASE_ID`; repeats use
`--fixture policy-15-repeat-1`. Offline review:

```sh
node --import tsx apps/server/scripts/review-interview-calibration.ts \
  apps/server/test/fixtures/interview-calibration-policy-15-focused-1.json \
  /private/tmp/spasht-grading-validation/policy-15-merged.json \
  /private/tmp/spasht-grading-validation/policy-15-initial-review.json
```

### Release decision and next work

**HOLD.** Declared uncertainty now appeared for the previously missed ambiguous speech and implicit
reasoning was credited on two selected inputs, but availability, over-cautious review, mixed-answer
classification, coverage and preferred routing are still not reliable enough for adaptation.
Offline shadow inspection assumes COMPLETE capture solely to expose grade consequences; no real audio,
actual adaptive update or learner question selection was tested here. Incorrect mixed grades would still
propose SIMPLIFY; P2-07 would propose DEEPEN rather than the preferred CLARIFY. Feature gates remain closed.

Next, separate the non-grade-bearing interpretation summary from the no-grade safety gate, preserving
strict status/source-ID/critical-field validation and historical v9 behavior. That formatting fix can be
unit/HTTP-tested without more paid calls and must be separately versioned rather than rewriting this run.
It will not fix semantic coverage, false-positive uncertainty or mixed knowledge. Investigate those
independently against question intent and keep all current labels/failed evidence. Do not claim a post-fix
real-model pass without a separately authorized run or launch another broad prompt rewrite on the basis
of this narrow formatting error. Broader/fresh domain, repeated, and real automated voice/workspace
validation remain necessary before adaptive production enablement.
