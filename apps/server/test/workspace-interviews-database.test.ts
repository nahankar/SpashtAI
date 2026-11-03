import { prepareWorkspaceTestRole } from './workspace-test-role'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { correctEvaluation, testAnswer } from './fixtures/interview-evaluation'
import { readyDraft } from './fixtures/bank-draft'
import { CURRENT_LEARNER_POLICY, LEARNER_POLICIES, hash } from '../src/interviews/evaluator/contracts'

const url = process.env.WORKSPACE_TEST_DATABASE_URL
if (url && url !== 'postgresql://postgres@127.0.0.1:55443/postgres') throw new Error('Use only the isolated tenancy container')
const suite = url ? describe : describe.skip

vi.mock('../src/interviews/evaluator/model', async original => ({
  ...await original<typeof import('../src/interviews/evaluator/model')>(),
  evaluateAnswer: vi.fn(async () => ({ result: correctEvaluation(), inputTokens: 10, outputTokens: 5, latencyMs: 1 })),
}))

suite('organization Interviews path', () => {
  const admin = new PrismaClient({ datasourceUrl: url || 'postgresql://unused:5432/unused' })
  const env = { database: process.env.DATABASE_URL, enabled: process.env.WORKSPACES_ENABLED }
  const tag = 'iv-' + randomUUID().replaceAll('-', '').slice(0, 10)
  const flagNames = ['interviews', 'interview_voice', 'interview_adaptive']
  let originalFlags: Awaited<ReturnType<typeof admin.platformFeatureFlag.findMany>> = []
  let originalVoices: Awaited<ReturnType<typeof admin.voiceConfig.findMany>> = []
  let testVoiceId = ''
  let originalShared: Awaited<ReturnType<typeof admin.interviewEvaluatorBudget.findUnique>> = null
  let db: PrismaClient
  let scopes: typeof import('../src/lib/dataScope')
  let requestScope: typeof import('../src/workspaces/requestScope')
  let practice: typeof import('../src/interviews/practice/service')
  let learnerEval: typeof import('../src/interviews/evaluator/learner')
  let readiness: Record<string, boolean>
  let alpha = '', beta = '', learner = '', editor = ''
  const extraLearners: string[] = []
  const questions: string[] = []
  const tz = 'Pacific/Kiritimati'

  const inWorkspace = async <T>(workspaceId: string, work: () => Promise<T>) =>
    scopes.runWithDataScope(await requestScope.resolveDataScope({ userId: learner, workspaceId }, 'request'), work)
  const setup = () => ({ sessionId: randomUUID(), track: tag, experienceBand: '2-5', startingDifficulty: 'Medium', durationMinutes: 10, recordingConsent: true })
  async function answered(runId: string, sessionId: string, index: number) {
    const attempt = await practice.prepareBankAttempt(runId, learner)
    const segment = index === 0
      ? await db.sessionSegment.create({ data: { id: randomUUID(), sessionId, segmentIndex: 0, roomName: randomUUID(), startedAt: new Date() } })
      : await db.sessionSegment.findFirstOrThrow({ where: { sessionId, endedAt: null } })
    await practice.markQuestionAsked(attempt.id, { segmentId: segment.id, questionText: attempt.question.text })
    await practice.captureCommittedTurn(attempt.id, { segmentId: segment.id, text: testAnswer, localTurnIndex: index, sourceTurnId: `user_turn_${index}`, role: 'user' })
    const receipt = await practice.saveCaptureReceipt(attempt.id, { id: randomUUID(), segmentId: segment.id, action: 'FINISH', lastTurnIndex: index })
    return practice.finishAnswer(runId, attempt.id, learner, false, receipt.id)
  }

  beforeAll(async () => {
    await prepareWorkspaceTestRole(admin)
    process.env.DATABASE_URL = 'postgresql://tenancy_test_app@127.0.0.1:55443/postgres'
    process.env.WORKSPACES_ENABLED = 'true'
    db = (await import('../src/lib/prisma')).prisma
    scopes = await import('../src/lib/dataScope')
    requestScope = await import('../src/workspaces/requestScope')
    practice = await import('../src/interviews/practice/service')
    learnerEval = await import('../src/interviews/evaluator/learner')
    readiness = (await import('../src/workspaces/productAccess')).WORKSPACE_FEATURE_READINESS
    readiness.interviews = true

    originalShared = await admin.interviewEvaluatorBudget.findUnique({ where: { scope_day: { scope: 'learner-global', day: new Date().toISOString().slice(0, 10) } } })
    originalFlags = await admin.platformFeatureFlag.findMany({ where: { feature: { in: flagNames } } })
    for (const feature of flagNames) {
      // Selected-user audience with no grants: only the organization entitlement can open the product.
      await admin.platformFeatureFlag.upsert({ where: { feature }, create: { feature, label: 'Test', hidden: false, disabled: false, enabled: true, audience: 'SELECTED_USERS' },
        update: { hidden: false, disabled: false, enabled: true, audience: 'SELECTED_USERS' } })
    }
    originalVoices = await admin.voiceConfig.findMany()
    await admin.voiceConfig.updateMany({ data: { isActive: false } })
    testVoiceId = (await admin.voiceConfig.upsert({ where: { backend: 'pipeline-bedrock' },
      create: { backend: 'pipeline-bedrock', displayName: 'Interview test', sttProvider: 'transcribe', ttsProvider: 'polly', isActive: true },
      update: { sttProvider: 'transcribe', ttsProvider: 'polly', isActive: true } })).id

    learner = (await admin.user.create({ data: { email: `${tag}-learner@example.invalid`, emailVerified: true } })).id
    editor = (await admin.user.create({ data: { email: `${tag}-editor@example.invalid`, emailVerified: true, role: 'SUPER_ADMIN' } })).id
    for (const name of ['alpha', 'beta']) {
      const ws = await admin.workspace.create({ data: { kind: 'ORGANIZATION', name, slug: `${tag}-${name}`, isolationStage: 'FOUNDATION_ONLY', timeZone: tz, dailyEvaluations: 1 } })
      if (name === 'alpha') alpha = ws.id; else beta = ws.id
      await admin.workspaceFeature.create({ data: { workspaceId: ws.id, feature: 'interviews', entitled: name === 'alpha', enabled: name === 'alpha' } })
      await admin.workspaceMember.create({ data: { workspaceId: ws.id, userId: learner, role: 'LEARNER', state: 'ACTIVE', acceptedAt: new Date() } })
    }
    const bank = await import('../src/interviews/bank/service')
    for (const qid of ['A', 'B']) {
      const id = await bank.createQuestion({ namespace: 'automation-pilot', externalQid: `${tag}-${qid}` }, { ...readyDraft(), track: tag }, editor)
      questions.push(id)
      await bank.confirmProvenance({ questions: [{ id, revision: 1 }], confirmed: true, note: 'Original disposable organization interview test content; no imported material.' }, editor)
      await bank.questionAction(id, 1, 'approve_activate', editor)
    }
  }, 60000)

  afterAll(async () => {
    if (readiness) readiness.interviews = false
    const ids = [learner, editor, ...extraLearners].filter(Boolean)
    await admin.interviewEvaluatorUsage.deleteMany({ where: { workspaceId: { in: [alpha, beta].filter(Boolean) } } })
    const shared = { scope: 'learner-global', day: new Date().toISOString().slice(0, 10) }
    if (originalShared) await admin.interviewEvaluatorBudget.update({ where: { scope_day: shared }, data: { used: originalShared.used } })
    else await admin.interviewEvaluatorBudget.deleteMany({ where: shared })
    await admin.interviewEvaluatorBudget.deleteMany({ where: { scope: { in: [`workspace-${alpha}`, `workspace-${beta}`, `learner-${hash(`${alpha}:${learner}`)}`] } } })
    await admin.session.deleteMany({ where: { userId: { in: ids } } })
    await admin.questionBankQuestion.deleteMany({ where: { id: { in: questions } } })
    await admin.workspace.deleteMany({ where: { OR: [{ id: { in: [alpha, beta].filter(Boolean) } }, { personalOwnerId: { in: ids } }] } })
    await admin.user.deleteMany({ where: { id: { in: ids } } })
    for (const feature of flagNames) {
      const original = originalFlags.find(row => row.feature === feature)
      if (original) await admin.platformFeatureFlag.update({ where: { feature }, data: { hidden: original.hidden, disabled: original.disabled, enabled: original.enabled, audience: original.audience } })
      else await admin.platformFeatureFlag.deleteMany({ where: { feature } })
    }
    if (testVoiceId && !originalVoices.some(v => v.id === testVoiceId)) await admin.voiceConfig.delete({ where: { id: testVoiceId } })
    for (const { id, createdAt, updatedAt, ...data } of originalVoices) await admin.voiceConfig.update({ where: { id }, data })
    await db?.$disconnect(); await admin.$disconnect()
    for (const [key, value] of Object.entries({ DATABASE_URL: env.database, WORKSPACES_ENABLED: env.enabled })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  })

  it('opens Interviews only inside the entitled organization and keeps its runs there', async () => {
    const run = await inWorkspace(alpha, () => practice.startPractice(setup(), learner))
    expect((await admin.session.findUniqueOrThrow({ where: { id: run.sessionId } })).workspaceId).toBe(alpha)
    await expect(practice.startPractice(setup(), learner)).rejects.toMatchObject({ status: 403 })
    await expect(inWorkspace(beta, () => practice.startPractice(setup(), learner))).rejects.toMatchObject({ status: 403 })
    expect(await db.interviewRun.findUnique({ where: { id: run.id } })).toBeNull()
    expect(await inWorkspace(beta, () => db.interviewRun.findUnique({ where: { id: run.id } }))).toBeNull()
    expect(await inWorkspace(alpha, () => db.interviewRun.findUnique({ where: { id: run.id } }))).not.toBeNull()
    await inWorkspace(alpha, () => practice.endPractice(run.id, learner))
  })

  it('charges the organization evaluation budget on its own calendar day, then grades in the organization job scope', async () => {
    const run = await inWorkspace(alpha, () => practice.startPractice(setup(), learner))
    const first = await inWorkspace(alpha, () => answered(run.id, run.sessionId, 0))
    const second = await inWorkspace(alpha, () => answered(run.id, run.sessionId, 1))
    const day = learnerEval.workspaceDay(tz)
    expect(await admin.interviewEvaluatorBudget.findUnique({ where: { scope_day: { scope: `workspace-${alpha}`, day } } })).toMatchObject({ used: 1 })
    const utcDay = new Date().toISOString().slice(0, 10)
    expect(await admin.interviewEvaluatorBudget.findUnique({ where: { scope_day: { scope: `learner-${hash(`${alpha}:${learner}`)}`, day: utcDay } } })).toMatchObject({ used: 1 })
    expect(await admin.interviewEvaluatorBudget.findUnique({ where: { scope_day: { scope: `learner-${hash(learner)}`, day: utcDay } } })).toBeNull()
    expect(await admin.interviewAssessment.findUniqueOrThrow({ where: { snapshotId: first.id! } })).toMatchObject({ status: 'PENDING' })
    expect(await admin.interviewAssessment.findUniqueOrThrow({ where: { snapshotId: second.id! } }))
      .toMatchObject({ status: 'FAILED', errorCode: 'EVALUATION_WORKSPACE_BUDGET_REACHED' })

    // The Personal worker cannot see organization work; the all-scope sweep grades it under a verified learner scope.
    expect(await scopes.runOutsideDataScope(() => learnerEval.claimLearnerAssessment())).toBeNull()
    expect(await learnerEval.sweepLearnerAssessmentsEverywhere()).toBe(true)
    const graded = await admin.interviewAssessment.findUniqueOrThrow({ where: { snapshotId: first.id! }, include: { usage: true } })
    expect(graded.status).toBe('COMPLETED')
    expect(graded.usage.map(row => [row.workspaceId, row.outcome])).toEqual([[alpha, 'SUCCESS']])

    await inWorkspace(alpha, () => practice.endPractice(run.id, learner))
    const findings = await inWorkspace(alpha, () => learnerEval.learnerFindings(run.id, learner))
    expect(JSON.stringify(findings)).toContain('Independent state identified')
    await expect(learnerEval.learnerFindings(run.id, learner)).rejects.toMatchObject({ status: 404 })
    await expect(inWorkspace(beta, () => learnerEval.learnerFindings(run.id, learner))).rejects.toMatchObject({ status: 404 })
  })

  it('pages more than 50 learner scopes so a later due learner is graded while earlier jobs retry', async () => {
    await admin.workspace.update({ where: { id: alpha }, data: { dailyEvaluations: 200 } })
    const draft = readyDraft()
    const questionSnapshot = {
      id: questions[0], namespace: 'automation-pilot', externalQid: `${tag}-A`, revision: 1,
      questionText: draft.questionText, track: tag, category: draft.category, topic: draft.topic,
      difficulty: 'Medium', experienceBand: '2-5', goodAnswerPoints: draft.goodAnswerPoints,
      exampleAnswer: draft.exampleAnswer, expectedDepth: draft.expectedDepth, followUpGuidance: draft.followUpGuidance,
    }
    const policy = { version: CURRENT_LEARNER_POLICY, config: LEARNER_POLICIES[CURRENT_LEARNER_POLICY].config }
    const questionHash = hash(questionSnapshot)
    const answerHash = hash(testAnswer)
    const created = await Promise.all(Array.from({ length: 51 }, (_, index) =>
      admin.user.create({ data: { email: `${tag}-page-${String(index).padStart(2, '0')}@example.invalid`, emailVerified: true } })))
    extraLearners.push(...created.map(user => user.id))
    await admin.workspaceMember.createMany({
      data: created.map(user => ({ workspaceId: alpha, userId: user.id, role: 'LEARNER', state: 'ACTIVE', acceptedAt: new Date() })),
    })
    const ordered = created.slice().sort((a, b) => a.id.localeCompare(b.id))
    const later = ordered[50]
    const future = new Date(Date.now() + 60 * 60_000)
    const snapshots: Record<string, string> = {}
    for (const user of ordered) {
      const sessionId = randomUUID()
      const runId = randomUUID()
      const attemptId = randomUUID()
      const snapshotId = randomUUID()
      const segmentId = randomUUID()
      snapshots[user.id] = snapshotId
      await admin.session.create({
        data: {
          id: sessionId, userId: user.id, module: 'elevate', purpose: 'INTERVIEW', contextScope: 'SESSION_ONLY',
          workspaceId: alpha, workspaceKind: 'ORGANIZATION',
        },
      })
      await admin.interviewRun.create({
        data: {
          id: runId, sessionId, ownerId: user.id, track: tag, experienceBand: '2-5', startingDifficulty: 'Medium',
          recordingConsentAt: new Date(), recordingConsentVersion: 'interview-recording-1',
          voiceConfigSnapshot: { backend: 'pipeline-bedrock', sttProvider: 'transcribe', ttsProvider: 'polly' },
          evaluationPolicySnapshot: policy,
        },
      })
      await admin.sessionSegment.create({
        data: { id: segmentId, sessionId, segmentIndex: 0, roomName: randomUUID(), startedAt: new Date() },
      })
      await admin.interviewAttempt.create({
        data: {
          id: attemptId, runId, index: 1, questionId: questions[0], questionSnapshot, questionHash,
          status: 'ASKED', askedAt: new Date(),
        },
      })
      await admin.interviewAnswerChunk.create({
        data: { attemptId, segmentId, sourceTurnId: `user_turn_${user.id}`, localTurnIndex: 0, text: testAnswer },
      })
      await admin.interviewCaptureReceipt.create({
        data: { id: randomUUID(), attemptId, segmentId, action: 'FINISH', lastTurnIndex: 0 },
      })
      await admin.interviewAttempt.update({
        where: { id: attemptId },
        data: { status: 'ANSWERED', completedAt: new Date() },
      })
      await admin.interviewAnswerSnapshot.create({
        data: {
          id: snapshotId, ownerId: user.id, source: 'LIVE_ATTEMPT', attemptId, questionId: questions[0],
          questionSnapshot, questionHash, answerText: testAnswer, answerHash, textSource: 'AGENT_COMMITTED_TURNS',
        },
      })
      await admin.interviewAssessment.create({
        data: {
          snapshotId, inputKey: hash({ snapshotId, userId: user.id }), config: policy.config as object,
          status: 'PENDING', nextAt: user.id === later.id ? new Date() : future,
        },
      })
    }

    expect(await learnerEval.sweepLearnerAssessmentsEverywhere()).toBe(true)
    expect(await admin.interviewAssessment.findUniqueOrThrow({ where: { snapshotId: snapshots[later.id] } }))
      .toMatchObject({ status: 'COMPLETED' })
    const retrying = await admin.interviewAssessment.findMany({
      where: { snapshotId: { in: ordered.slice(0, 50).map(user => snapshots[user.id]) } },
    })
    expect(retrying).toHaveLength(50)
    expect(retrying.every(row => row.status === 'PENDING')).toBe(true)
  }, 120000)

  it('uses the organization time zone for the budget day', () => {
    const at = new Date('2026-11-03T12:00:00Z')
    expect(learnerEval.workspaceDay('Pacific/Kiritimati', at)).toBe('2026-11-04')
    expect(learnerEval.workspaceDay('America/Los_Angeles', new Date('2026-11-03T05:00:00Z'))).toBe('2026-11-02')
    expect(learnerEval.workspaceDay('UTC', at)).toBe('2026-11-03')
  })
})
