#!/usr/bin/env node
// Local-only regression checks. Never import the paid calibration runner here.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('npm run grading:check [-- --code-only]\nDefault: offline tests + saved synthetic grading review (exit 2 = HOLD).\n--code-only: regression tests only; never a grading/release approval.\nNo AWS, database, app or credentials required. Evidence: tools/interview-grading/runs/.');
  process.exit(0);
}
if (args.some(arg => arg !== '--code-only') || args.length > 1) {
  console.error('Unknown arguments. Use npm run grading:check -- --help');
  process.exit(1);
}
const codeOnly = args.includes('--code-only');
const startedAt = Date.now();
const output = path.join(root, 'tools/interview-grading/runs', new Date().toISOString().replace(/[:.]/g, '-'));
const guard = path.join(root, 'tools/interview-grading/deny-network.cjs');
const fixture = path.join(root, 'apps/server/test/fixtures/interview-calibration-question-scope-focused-1.json');
const saved = path.join(root, 'apps/server/test/fixtures/interview-grading-saved-scope-1.json');
const datasets = [
  { name: 'historical-scope', fixture, saved },
  ...['ambiguity-baseline-1', 'ambiguity-repeat-1'].map(name => ({ name,
    fixture: path.join(root, `apps/server/test/fixtures/interview-calibration-${name}.json`),
    saved: path.join(root, `apps/server/test/fixtures/interview-grading-saved-${name}.json`),
  })),
];
const summary = { mode: 'offline', freshProviderCalls: 0, codeOnly, codeChecks: 'ERROR', gradingEvidence: 'NOT_REVIEWED', release: 'NOT_ASSESSED' };
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'USERPROFILE'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, { NODE_ENV: 'test', AWS_EC2_METADATA_DISABLED: 'true',
  NODE_OPTIONS: `--require ${JSON.stringify(guard)}` });

async function run(label, command, childArgs, cwd, timeoutMs = 120000) {
  const logPath = path.join(output, `${label}.log`);
  const log = createWriteStream(logPath, { mode: 0o600 });
  let timedOut = false;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, childArgs, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); clearTimeout(killTimer); log.end(); reject(error); });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer);
      log.end(() => resolve({ exitCode: code, timedOut, log: path.relative(root, logPath) }));
    });
  });
}
const digest = async filename => createHash('sha256').update(await readFile(filename)).digest('hex');
try {
  await mkdir(output, { recursive: true, mode: 0o700 });
  const vitest = path.join(root, 'node_modules/vitest/vitest.mjs');
  try { await access(vitest); await access(path.join(root, 'node_modules/tsx/package.json')); }
  catch { throw new Error('Missing local test dependencies. Install repository dependencies once with npm install, then rerun. This command never downloads packages.'); }
  summary.source = await run('revision', 'git', ['rev-parse', 'HEAD'], root, 5000);
  if (summary.source.exitCode !== 0) throw new Error('Cannot identify the checkout revision.');
  summary.applicationRevision = (await readFile(path.join(output, 'revision.log'), 'utf8')).trim();
  const state = await run('git-state', 'git', ['status', '--porcelain'], root, 5000);
  if (state.exitCode !== 0) throw new Error('Cannot identify checkout changes.');
  summary.workingTreeDirty = Boolean((await readFile(path.join(output, 'git-state.log'), 'utf8')).trim());
  summary.fixtureHash = await digest(fixture);
  summary.savedEvidenceHash = await digest(saved);
  const provenance = JSON.parse(await readFile(saved, 'utf8')).provenance;
  if (provenance.fixtureSha256 !== summary.fixtureHash) throw new Error('Frozen fixture changed. Saved evidence must be reviewed against its original labels, not silently relabelled.');
  summary.guard = await run('guard', process.execPath, ['--test', 'tools/interview-grading/guard.test.cjs'], root);
  if (summary.guard.exitCode !== 0 || summary.guard.timedOut) throw new Error('Offline network guard tests failed.');
  summary.tests = await run('tests', process.execPath, [vitest, 'run',
    'test/interview-evaluator.test.ts', 'test/interview-separated-grading.test.ts',
    'test/interview-interpretation-first.test.ts', 'test/interview-review-boundary.test.ts',
    'test/interview-calibration-bank.test.ts', 'test/interview-calibration-review.test.ts',
    'test/interview-grading-saved-evidence.test.ts', 'test/interview-diagnostic-plan.test.ts',
    'test/interview-ambiguity-saved-evidence.test.ts',
    '--no-file-parallelism', '--maxWorkers', '1', '--reporter=json',
    '--outputFile', path.join(output, 'tests.json')], path.join(root, 'apps/server'));
  if (summary.tests.exitCode !== 0 || summary.tests.timedOut) throw new Error('Regression tests failed or timed out. Inspect tests.log.');
  const tests = JSON.parse(await readFile(path.join(output, 'tests.json'), 'utf8'));
  if (!tests.success || !tests.numPassedTests || tests.numFailedTests) throw new Error('Missing or unsuccessful regression evidence.');
  summary.codeChecks = 'PASS';
  summary.passedTests = tests.numPassedTests;
  if (!codeOnly) {
    summary.savedReviews = [];
    summary.disagreements = [];
    let held = false;
    for (const dataset of datasets) {
      const fixtureHash = await digest(dataset.fixture);
      const evidenceProvenance = JSON.parse(await readFile(dataset.saved, 'utf8')).provenance;
      if (evidenceProvenance.fixtureSha256 !== fixtureHash) throw new Error(`Frozen fixture changed: ${dataset.name}`);
      const result = await run(dataset.name, process.execPath, ['--import', 'tsx',
        'apps/server/scripts/review-interview-calibration.ts', dataset.fixture, dataset.saved,
        path.join(output, `${dataset.name}-review.json`)], root);
      if (result.timedOut || ![0, 1].includes(result.exitCode)) throw new Error(`Saved evidence review incomplete: ${dataset.name}`);
      const review = JSON.parse(await readFile(path.join(output, `${dataset.name}-review.json`), 'utf8'));
      const datasetHeld = review.decision === 'HOLD_GRADE_DRIVEN_ADAPTATION';
      if (!['HOLD_GRADE_DRIVEN_ADAPTATION', 'SAMPLE_PASSED_REVIEW_STILL_REQUIRED'].includes(review.decision)
        || result.exitCode !== (datasetHeld ? 1 : 0) || !review.summary?.cases) throw new Error('Invalid saved review outcome.');
      held ||= datasetHeld;
      summary.savedReviews.push({ name: dataset.name, decision: review.decision, summary: review.summary,
        fixtureHash, savedEvidenceHash: await digest(dataset.saved), evidenceProvenance });
      summary.disagreements.push(...review.reviews.filter(r => r.failures.length || r.exactExpected === false)
        .map(r => ({ dataset: dataset.name, id: r.id, actual: r.actual, failures: r.failures,
          preferredLabelMismatch: r.exactExpected === false })));
    }
    summary.gradingEvidence = held ? 'HOLD' : 'SAVED_SAMPLE_PASS_ONLY';
    summary.release = held ? 'HOLD' : 'FRESH_VALIDATION_STILL_REQUIRED';
    process.exitCode = held ? 2 : 0;
  }
} catch (error) {
  summary.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  summary.elapsedMs = Date.now() - startedAt;
  summary.exitCode = process.exitCode ?? 0;
  await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
  console.log(`Code checks: ${summary.codeChecks}${summary.passedTests ? ` (${summary.passedTests} tests)` : ''}`);
  console.log(`Saved grading evidence: ${summary.gradingEvidence}. Release: ${summary.release}.`);
  console.log('No fresh model evaluation. No database, app or voice validation.');
  if (summary.error) console.error(summary.error);
  if (summary.disagreements?.length) console.log(`Disagreements: ${summary.disagreements.map(r => `${r.dataset}/${r.id}`).join(', ')}`);
  console.log(`Evidence: ${path.relative(root, output)}/summary.json`);
}
