// Opt-in local/internal benchmark. Uses the same gate, quota and saved-job path as Admin.
// Example: tsx scripts/calibrate-interview-evaluator.ts <admin-id> <report.json>
import { readFile, writeFile } from 'node:fs/promises'
import { prisma } from '../src/lib/prisma'
import { CONFIGS } from '../src/interviews/evaluator/contracts'
import { assessmentDetail, enqueueAssessment, sweepAssessments } from '../src/interviews/evaluator/service'
const [actorId, output] = process.argv.slice(2)
if (!actorId || !output) throw new Error('Provide a pilot Admin ID and report path. Model calls incur usage.')
const cases = JSON.parse(await readFile(new URL('../test/fixtures/interview-calibration.json', import.meta.url), 'utf8')) as { name: string; qid: string; expected: string; answer: string }[]
const results: unknown[] = []
try {
  for (const model of Object.keys(CONFIGS) as (keyof typeof CONFIGS)[]) {
    for (const test of cases) {
      const question = await prisma.questionBankQuestion.findUniqueOrThrow({ where: { namespace_externalQid: { namespace: 'automation-pilot', externalQid: test.qid } } })
      if (!question.approved || !question.active) throw new Error(`Activate the pilot question ${test.qid} before running calibration`)
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
      const result = assessment.result as { classification?: string; next?: { action: string; topic: string | null; source: string } } | null
      const record = { name: test.name, qid: test.qid, track: question.track, difficulty: question.difficulty, expected: test.expected, model,
        passed: result?.classification === test.expected, assessmentId: assessment.id, reused: submitted.reused, status: assessment.status,
        errorCode: assessment.errorCode, endToEndMs: Date.now() - start, usage: assessment.usage, result,
        topicSwitchPassed: test.expected === 'NOT_ANSWERED' ? Boolean(result?.next?.source === 'BANK' && result.next.topic?.toLowerCase() !== question.topic.toLowerCase()) : null }
      results.push(record)
      console.log(JSON.stringify({ name: record.name, model, passed: record.passed, status: record.status, topicSwitchPassed: record.topicSwitchPassed }))
      await writeFile(output, JSON.stringify({ fixtureVersion: 'synthetic-1', source: 'ADMIN_TEST', expertReviewed: false, calibrated: false,
        limitation: 'Small synthetic development set. Independent expert labels and a holdout set are required before live grading.', results }, null, 2))
    }
  }
} finally { await prisma.$disconnect() }
