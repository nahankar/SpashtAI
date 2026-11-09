// Pure offline planning. No Prisma, provider, queue, deletion or quota mutation.
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { LEARNER_POLICIES, deterministicResult, hash } from '../src/interviews/evaluator/contracts'
const fixtureNames = ['ambiguity-baseline-1', 'ambiguity-repeat-1'] as const
const sourceName = 'question-scope-focused-1'
type Case = { id: string; qid: string; answer: string; [key: string]: unknown }
type Fixture = { fixtureVersion: string; namespace: string; questions: Record<string, unknown>; cases: Case[] }
const expectedConfig = '0f6f309aec2d53806612cac4180f1b4349b6dca98c4681fe1e6e5f93ebe0148a'
const originalIds = ['N15-03', 'N15-01', 'P2-02']
export function diagnosticPlan(initial: Fixture, repeat: Fixture, original: Fixture, contrasts: Fixture) {
  if (initial.fixtureVersion !== fixtureNames[0] || repeat.fixtureVersion !== fixtureNames[1]) throw Error('Wrong diagnostic fixture versions')
  for (const fixture of [initial, repeat]) {
    if (fixture.namespace !== 'grading-scope-1' || fixture.namespace !== original.namespace) throw Error('Wrong diagnostic bank')
    if (new Set(fixture.cases.map(c => c.id)).size !== fixture.cases.length) throw Error('Duplicate diagnostic case')
    for (const c of fixture.cases) {
      if (!c.id || !c.answer.trim() || !c.qid) throw Error('Incomplete diagnostic case')
      if (!fixture.questions[c.qid] || !original.questions[c.qid] || hash(fixture.questions[c.qid]) !== hash(original.questions[c.qid])) throw Error('Question pin mismatch')
    }
  }
  const added = initial.cases.filter(c => !originalIds.includes(c.id))
  if (contrasts.fixtureVersion !== 'ambiguity-contrasts-1' || hash(added) !== hash(contrasts.cases)) throw Error('New contrast cases changed')
  if (initial.cases.length !== 9 || repeat.cases.length !== 3 || repeat.cases.some(c => !originalIds.includes(c.id))) throw Error('Expected nine initial trials and three specified repeats')
  for (const id of originalIds) {
    const a = initial.cases.find(c => c.id === id), b = repeat.cases.find(c => c.id === id), old = original.cases.find(c => c.id === id)
    if (!a || !b || !old || hash(a) !== hash(b) || hash(a) !== hash(old)) throw Error('Historical control/repeat changed')
  }
  const policy = LEARNER_POLICIES['learner-evaluation-16']
  if ([...initial.cases, ...repeat.cases].some(c => deterministicResult(policy, c.answer))) throw Error('Paid-call count includes a deterministic control')
  const config = policy.config
  if (hash(config) !== expectedConfig) throw Error('Policy 16 configuration changed')
  return { status: 'PREPARED_NOT_EXECUTED', callsAuthorized: false, paidCallsProposed: 12, initialTrials: 9, freshRepeats: 3,
    policy: config.policy, modelId: config.modelId, region: config.region, configHash: expectedConfig,
    reasoningEffort: config.reasoningEffort, maxTokensPerInvocation: config.maxTokens,
    maximumConfiguredOutputTokens: config.maxTokens * 12, timeoutMsPerInvocation: config.timeoutMs,
    repeatIds: originalIds, namespace: initial.namespace,
    prerequisites: ['Separate bounded allowance and sufficient remaining normal actor/global UTC-day quota',
      'Read-only restricted-role bank/config preflight', 'Preserve existing synthetic reports before any normal Admin-test deletion',
      'Every paid trial must be fresh; identical answer/question/config/input pins for repeats',
      'Stop on prerequisite/access/configuration failure; no automatic retry or quota expansion'],
    release: 'HOLD', limitation: 'Offline input/plan checks only. No model correctness, access, quota or voice validation. P2-07 routing-label disagreement is outside this diagnostic.' }
}
export async function loadDiagnosticPlan() {
  const urls = [...fixtureNames, sourceName, 'ambiguity-contrasts-1'].map(n => new URL(`../test/fixtures/interview-calibration-${n}.json`, import.meta.url))
  const bytes = await Promise.all(urls.map(u => readFile(u, 'utf8')))
  const [initial, repeat, original, contrasts] = bytes.map(b => JSON.parse(b) as Fixture)
  return { ...diagnosticPlan(initial, repeat, original, contrasts), fixtures: urls.map((u, i) => ({
    file: fileURLToPath(u), sha256: createHash('sha256').update(bytes[i]).digest('hex'),
  })) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await loadDiagnosticPlan(), null, 2))
