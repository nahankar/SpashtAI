# Offline Interview grading checks

From this repository's root, run:

```sh
npm run grading:check
```

One-time prerequisite: Node and the repository's npm dependencies (`npm install` if not installed).
The launcher checks dependencies and never installs/downloads them. No Docker, app, database, AWS,
API key, login or chat agent is needed. Do not load a credentials file for this command.
It does not stop or change any running services. Use this branch/worktree; older checkouts lack this command.

## Read the result

- **Code checks PASS**: focused evaluator/parser, uncertainty boundary, bank-pin and acceptance-review
  regression tests passed. AWS SDK calls are mocked. Separate guard tests check Node network blocking.
- **Saved grading evidence HOLD**: the saved November 9 synthetic trial still contains real grading
  disagreements. This is expected today. It is not a newly failed model invocation and must not be
  relabelled as a pass. Code tests explicitly ensure those historical failures remain visible.
- Exit **0**: code-only checks passed, or a saved sample passed its checks (still not release approval).
  Exit **2**: code checks passed but saved evidence holds adaptive release. Exit **1**: invalid arguments,
  missing dependencies, failed/timed-out tests or invalid evidence; investigate the saved log.

For code checks alone:

```sh
npm run grading:check -- --code-only
```

That command makes **no grading-quality or release-readiness claim**. Default replay includes the historical 20 initial synthetic rows (18 model results plus two reused
deterministic controls), the 10 November diagnostic's nine initial results plus three fresh repeats, and the 11 November LOW/MEDIUM comparison's sixteen paired results.
The historical trial's two later paid repeats are not in its projection. Each projection pins its original application/configuration and fixture hash.
The projection excludes operational identifiers, usage logs, raw provider bodies and hidden reasoning.
Only synthetic answers/results are committed; no learner data, credentials, audio or authentication state.

## Evidence and reuse

Each invocation prints the path to `tools/interview-grading/runs/<timestamp>/summary.json`.
The directory is ignored by Git and created private to the local user. The summary has current Git revision,
working-tree dirty status, fixture/evidence hashes, test count, disagreements, duration and exit code.
Detailed test results, logs and the saved review are next to it. A dirty checkout is reported, not described
as a clean revision. Check the summary before sharing; do not share environment files or unrelated logs.

Future agents should run this command and read **summary.json first**, opening detailed logs only on a
failure or unexplained change. Reuse these tests and fixture projections; do not repeatedly reconstruct
this benchmark in chat. Running locally without an agent uses no assistant tokens and makes no paid
provider calls. It still uses your computer's CPU/time. No exact token/cost saving is promised.

Tests and the offline reviewer run with a small inherited environment, no credential-file loading and a
preloaded Node guard that rejects HTTP, HTTPS, fetch, TCP and TLS connections. This is a safeguard for
this fixed local workflow, not an OS sandbox for arbitrary third-party commands. Each test/review subprocess
has a two-minute deadline. Do not add live/provider/DB tests to this suite or bypass the guard to get green.

## Reviewing another already-saved report

The existing reviewer is also reusable without paying for a new evaluation:

```sh
node --require ./tools/interview-grading/deny-network.cjs --import tsx \
  apps/server/scripts/review-interview-calibration.ts \
  /absolute/path/to/frozen-fixture.json /absolute/path/to/saved-results.json \
  /absolute/path/to/private-review.json
```

This lower-level reviewer exits **1 for HOLD** (unlike the convenience launcher's exit 2).
Use matching fixture versions and the original expected labels. It is not a model call, bank/auth preflight,
voice test or complete application test. Retain the original evidence; do not overwrite failed results.

A changed model, prompt, bank or active grading path requires fresh bounded validation, followed by relevant
real automated voice/workspace acceptance before release. Replaying old results cannot demonstrate that a
new model fix works. Paid runs remain separate and require an available, approved allowance. The latest approved allowance
is exhausted; this command cannot raise or reset quotas and never imports the paid calibration runner.

See `docs/prepare/INTERVIEWS-GRADING-OFFLINE-AUDIT.md` for the current failure investigation and next experiment.

To inspect the original 12-call diagnostic definition without running it:

```sh
npm run grading:plan
```

This prints the frozen fixture/configuration hashes and proposed 12-call bound. It is offline and cannot
submit work or authorize spending. Read `docs/prepare/INTERVIEWS-AMBIGUITY-DIAGNOSTIC.md` for the observed
read-only bank/quota preflight and execution prerequisites. Planning is not a model-quality result.

The 10 November 12-call results are in `docs/prepare/INTERVIEWS-AMBIGUITY-DIAGNOSTIC.md`. The saved C1-04
expectation is disputed but retained. A test passing because it detects that disagreement is not model-quality
success. Each saved dataset has its own review JSON and provenance in the compact summary.

The future acceptance decisions are recorded in `docs/prepare/INTERVIEWS-GRADING-BOUNDARY-ADJUDICATION.md`.
There are ten versioned acceptance cases; six have now been measured in the LOW/MEDIUM comparison and four remain untested. The offline summary marks this coverage as partial; they do not replace or rescore older saved rows. Synthetic acceptance-checker
tests are code tests, not fresh model trials or proof of semantic reliability.

Historical snapshots remain failed even after a future model fix. Their replay is an audit, not a requirement
to rewrite old evidence until it turns green. Candidate release readiness must use separately identified fresh
results for that candidate; the current adaptive feature still lacks that passing reliability evidence.

The completed inactive LOW/MEDIUM comparison is recorded in `docs/prepare/INTERVIEWS-MEDIUM-THINKING-COMPARISON.md`.
Its preparation transport tests used the owned HTTP fixture; its subsequent 16 real-model calls rejected MEDIUM for promotion. The offline check replays those saved results and request-envelope tests without making provider calls.
