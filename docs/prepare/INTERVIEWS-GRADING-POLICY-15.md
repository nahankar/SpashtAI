# Interpretation-first grading preview 15 — 9 November 2026

**Prepared and locally validated; real-model behavior is untested. HOLD adaptive Interviews.**
Active learner grading stays `learner-evaluation-8`. No production changes, migration, model calls,
question selection or learner-state updates were made. This branch builds on the measured OFF/LOW
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

## Frozen next test — not executed

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
not independent human/domain-expert validation. The new cases have not been run against this or earlier
model policies. They are not independent-domain holdouts; broader domain coverage remains necessary.
The new interpretation illustration is not itself a benchmark answer. Do not change labels after outputs.

A future bounded run would cost **at most 20 paid calls**: 16 initial plus four fresh repeats, including
one initial canary. Two controls are free. Freeze tested revision/config; verify the isolated database,
restricted role and question revisions; stop on configuration/access/prerequisite/token-limit errors.
Persist first-trial results before owned fictional snapshot replacement. Verify repeats have new IDs,
reused=false and identical answer/question/config/input hashes. No counter reset or new quota identity.
Retries consume the same bound and displace planned cases. The maximum configured generation allowance
is 300,000 tokens; actual input/output usage and latency must be reported, no speculative dollar estimate.

The preceding approved comparison used all 20 calls (actor/global day usage reached 60). **No additional
paid call is authorized by that exhausted allowance.** A new bounded allowance is required before this
preview's real-model run. Source limits stay 20/admin/day and 100/global/day; production is unchanged.

Acceptance: report usable grades, invalid output, safe ungraded review, accepted and preferred grades,
semantic/evidence/feedback checks, held-core results, repeated dispositions/shadow actions, latency and
usage separately. Wrong-but-stable labels do not pass. Neither generic failures nor indiscriminate review
count as correct uncertainty handling. Do not publish a general reliability claim from this small set.

## Local validation

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
