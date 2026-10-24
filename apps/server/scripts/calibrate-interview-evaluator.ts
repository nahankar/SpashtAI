// Opt-in local/internal benchmark. Uses the same gate, quota and saved-job path as Admin.
// Example: tsx scripts/calibrate-interview-evaluator.ts <admin-id> <report.json> [--fixture reviewed-1] [--model nova2_lite|nova_pro|learner-evaluation-2|all] [--only R1-01,R1-02]
// A learner-evaluation-N model previews that learner grading policy through the Admin test path.
// The default fixture is the original synthetic set. Each model-evaluated case costs one Admin test
// from the daily quota (a learner-policy preview of an explicit "I don't know" is deterministic and
// free). Quotas are never raised or bypassed here, so a larger set runs across several UTC days.
import { readFile, writeFile } from 'node:fs/promises'
import { prisma } from '../src/lib/prisma'
import { ADMIN_MODELS, CONFIGS, PREVIEW_POLICIES, adminConfig } from '../src/interviews/evaluator/contracts'
import { assessmentDetail, enqueueAssessment, sweepAssessments } from '../src/interviews/evaluator/service'

type Case = { id?: string; name?: string; qid: string; category?: string; expected: string; acceptable?: string[]; mustNotBe?: string[]
  answer: string; evidence?: string[]; mustNotQuote?: string[]; expectMisconception?: boolean; expectGap?: string; notes?: string }
type Fixture = { fixtureVersion: string; reviewer?: string; questions?: Record<string, { revision: number; guidanceIssues: string[] }>; cases: Case[] }
type Result = { classification?: string; criteria?: { criterion: string; finding: string; evidence: string[] }[]; strengths?: string[]
  gaps?: string[]; misconceptions?: string[]; uncertainty?: string[]; next?: { action: string; topic: string | null; source: string } }

const [actorId, output, ...flags] = process.argv.slice(2)
if (!actorId || !output) throw new Error('Provide a pilot Admin ID and report path. Model calls incur usage.')
const flag = (name: string) => { const i = flags.indexOf(`--${name}`); return i >= 0 ? flags[i + 1] : undefined }
const fixtureName = flag('fixture')
const fixturePath = new URL(`../test/fixtures/${fixtureName ? `interview-calibration-${fixtureName}` : 'interview-calibration'}.json`, import.meta.url)
const raw = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture | Case[]
const fixture: Fixture = Array.isArray(raw) ? { fixtureVersion: 'synthetic-1', cases: raw } : raw
const only = flag('only')?.split(',')
const cases = fixture.cases.filter(c => !only || only.includes(c.id ?? c.name ?? ''))
const modelFlag = flag('model') ?? 'nova2_lite'
const models = modelFlag === 'all' ? Object.keys(CONFIGS) : [modelFlag]
if (!models.every(m => ADMIN_MODELS.includes(m))) throw new Error(`Unknown model ${modelFlag}`)

const percentile = (values: number[], p: number) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1)]
}
function review(test: Case, answer: string, result: Result | null) {
  if (!result?.classification) return null
  const quotes = (result.criteria ?? []).flatMap(c => c.evidence)
  const lower = (items: string[] | undefined) => (items ?? []).join(' ').toLowerCase()
  return {
    acceptable: (test.acceptable ?? [test.expected]).includes(result.classification),
    forbidden: (test.mustNotBe ?? []).includes(result.classification),
    // The parser already rejects inexact quotes; this re-checks what was actually persisted.
    quotesExact: quotes.every(q => answer.includes(q)),
    evidenceAnchorQuoted: test.evidence?.length ? test.evidence.some(a => quotes.some(q => q.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(q.toLowerCase()))) : null,
    forbiddenQuote: (test.mustNotQuote ?? []).some(a => quotes.some(q => q.toLowerCase().includes(a.toLowerCase())) || lower(result.strengths).includes(a.toLowerCase())),
    misconceptionReported: test.expectMisconception === undefined ? null : (result.misconceptions?.length ?? 0) > 0,
    unexpectedMisconception: !test.expectMisconception && (result.misconceptions?.length ?? 0) > 0,
    expectedGapReported: test.expectGap ? lower(result.gaps).includes(test.expectGap.toLowerCase()) : null,
  }
}

const results: Record<string, unknown>[] = []
const write = () => {
  const usage = results.flatMap(r => (r.usage as { latencyMs: number; inputTokens: number | null; outputTokens: number | null; outcome: string }[]) ?? [])
  const graded = results.filter(r => r.review)
  const count = (pred: (r: Record<string, unknown>) => boolean) => results.filter(pred).length
  const summary = {
    cases: results.length, completed: count(r => r.status === 'COMPLETED'),
    agreement: count(r => (r.review as { acceptable?: boolean } | null)?.acceptable === true), exactExpected: count(r => r.passed === true),
    forbiddenClassification: count(r => (r.review as { forbidden?: boolean } | null)?.forbidden === true),
    invalidOutputJobs: count(r => String(r.errorCode ?? '').startsWith('INVALID_OUTPUT')),
    providerFailureJobs: count(r => r.status !== 'COMPLETED' && !String(r.errorCode ?? '').startsWith('INVALID_OUTPUT')),
    invocations: usage.length, invocationOutcomes: usage.reduce<Record<string, number>>((a, u) => ({ ...a, [u.outcome]: (a[u.outcome] ?? 0) + 1 }), {}),
    modelLatencyMs: { p50: percentile(usage.map(u => u.latencyMs), 50), p95: percentile(usage.map(u => u.latencyMs), 95), max: percentile(usage.map(u => u.latencyMs), 100) },
    endToEndMs: { p50: percentile(results.map(r => r.endToEndMs as number), 50), p95: percentile(results.map(r => r.endToEndMs as number), 95) },
    // Missing provider usage is reported as unknown, never as zero.
    tokens: { input: usage.every(u => u.inputTokens !== null) ? usage.reduce((s, u) => s + (u.inputTokens ?? 0), 0) : null,
      output: usage.every(u => u.outputTokens !== null) ? usage.reduce((s, u) => s + (u.outputTokens ?? 0), 0) : null,
      invocationsWithUnknownUsage: usage.filter(u => u.inputTokens === null || u.outputTokens === null).length },
    quotesExact: graded.every(r => (r.review as { quotesExact: boolean }).quotesExact),
  }
  return writeFile(output, JSON.stringify({ fixtureVersion: fixture.fixtureVersion, reviewer: fixture.reviewer ?? null, source: 'ADMIN_TEST',
    configs: models.map(m => adminConfig(m)), questions: fixture.questions ?? null, calibrated: false,
    limitation: 'Small development set reviewed against bank guidance. Agreement on this sample is not a calibration claim.', summary, results }, null, 2))
}
try {
  for (const model of models) {
    for (const test of cases) {
      const question = await prisma.questionBankQuestion.findUniqueOrThrow({ where: { namespace_externalQid: { namespace: 'automation-pilot', externalQid: test.qid } } })
      if (!question.approved || !question.active) throw new Error(`Activate the pilot question ${test.qid} before running calibration`)
      const pinned = fixture.questions?.[test.qid]?.revision
      // Labels were reviewed against a specific guidance revision.
      if (pinned !== undefined && pinned !== question.revision) throw new Error(`${test.qid} changed from reviewed revision ${pinned} to ${question.revision}; re-review the labels`)
      const start = Date.now()
      const submitted = await enqueueAssessment({ questionId: question.id, revision: question.revision, answer: test.answer, source: 'ADMIN_TEST', model }, actorId)
      // The normal API worker may claim the job concurrently. Persisted input keys share its result.
      let assessment = await assessmentDetail(submitted.id, actorId)
      const deadline = Date.now() + 100_000
      while (['PENDING','RUNNING'].includes(assessment.status) && Date.now() < deadline) {
        await sweepAssessments()
        assessment = await assessmentDetail(submitted.id, actorId)
        if (['PENDING','RUNNING'].includes(assessment.status)) await new Promise(resolve => setTimeout(resolve, 1000))
      }
      const result = assessment.result as Result | null
      const record = { id: test.id ?? null, name: test.name ?? test.id, category: test.category ?? null, qid: test.qid, track: question.track,
        difficulty: question.difficulty, expected: test.expected, acceptable: test.acceptable ?? [test.expected], model,
        actual: result?.classification ?? null, passed: result?.classification === test.expected, review: review(test, test.answer, result),
        assessmentId: assessment.id, reused: submitted.reused, status: assessment.status, errorCode: assessment.errorCode,
        endToEndMs: Date.now() - start, usage: assessment.usage.map(u => ({ latencyMs: u.latencyMs, inputTokens: u.inputTokens, outputTokens: u.outputTokens, outcome: u.outcome })),
        answer: test.answer, notes: test.notes ?? null, result,
        // Learner-policy previews propose no next step, so the Admin topic switch does not apply.
        topicSwitchPassed: test.expected === 'NOT_ANSWERED' && !PREVIEW_POLICIES.includes(model) ? Boolean(result?.next?.source === 'BANK' && result.next.topic?.toLowerCase() !== question.topic.toLowerCase()) : null }
      results.push(record)
      console.log(JSON.stringify({ id: record.id ?? record.name, model, expected: record.expected, actual: record.actual, acceptable: record.review?.acceptable ?? null, status: record.status, errorCode: record.errorCode }))
      await write()
    }
  }
} finally { await prisma.$disconnect() }
