import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { getEnabledFeatures } from '../lib/featureFlags'
import { isCoachFocusArea, type CoachFocusArea } from './focusAreas'

const RESULT_WINDOW_DAYS = 30
const PULSE_WINDOW_DAYS = 90
const MIN_PULSE_SESSIONS = 2
// Session has no last-activity timestamp. Bound resume to a normal working
// window so abandoned rows do not permanently outrank useful recommendations.
const LIVE_RESUME_HOURS = 4

export type CoachHomeRecommendation =
  | {
      kind: 'result'
      module: 'elevate' | 'replay'
      targetId: string
      threadId: string | null
      title: string
      reason: string
      insight: string | null
      completedAt: string
    }
  | {
      kind: 'live-resume'
      module: 'elevate'
      targetId: string
      threadId: string | null
      title: string
      reason: string
      startedAt: string
    }
  | {
      kind: 'resume'
      threadId: string
      title: string
      question: string
      updatedAt: string
    }
  | {
      kind: 'prepare'
      threadId: string | null
      preparationId: string
      stageId: string
      stageName: string
      goalTitle: string
      title: string
      reason: string
      scenario: string
      scheduledAt: string
    }
  | {
      kind: 'pulse'
      threadId: string | null
      skill: CoachFocusArea
      score: number
      sessions: number
      practiceAvailable: boolean
      goalTitle: string
      title: string
      reason: string
    }
  | {
      kind: 'onboarding'
      title: string
      reason: string
    }

type ResultCandidate = Extract<CoachHomeRecommendation, { kind: 'result' }>
type LiveResumeCandidate = Extract<CoachHomeRecommendation, { kind: 'live-resume' }>
type ResumeCandidate = Extract<CoachHomeRecommendation, { kind: 'resume' }>
type PrepareCandidate = Extract<CoachHomeRecommendation, { kind: 'prepare' }>
type PulseCandidate = Extract<CoachHomeRecommendation, { kind: 'pulse' }>

export interface CoachHomeCandidates {
  results: ResultCandidate[]
  liveSessions: LiveResumeCandidate[]
  resumes: ResumeCandidate[]
  preparations: PrepareCandidate[]
  pulse: PulseCandidate[]
}

export function selectCoachHomeRecommendation(
  candidates: CoachHomeCandidates,
): CoachHomeRecommendation {
  const result = [...candidates.results].sort(
    (a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt),
  )[0]
  if (result) return result

  const liveSession = [...candidates.liveSessions].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  )[0]
  if (liveSession) return liveSession

  const resume = [...candidates.resumes].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  )[0]
  if (resume) return resume

  const preparation = [...candidates.preparations].sort(
    (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
  )[0]
  if (preparation) return preparation

  const pulse = [...candidates.pulse].sort(
    (a, b) => a.score - b.score || b.sessions - a.sessions,
  )[0]
  if (pulse) return pulse

  return {
    kind: 'onboarding',
    title: 'What would you like to get better at—or prepare for?',
    reason: 'Tell Coach what matters right now. It will recommend the best next step.',
  }
}

function jsonText(value: Prisma.JsonValue | null, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim().slice(0, 240)
    : null
}

export function hasReadyElevateResult(
  skillScores: Prisma.JsonValue | null,
  coachingInsights: Prisma.JsonValue | null,
): boolean {
  if (!skillScores || typeof skillScores !== 'object' || Array.isArray(skillScores)) return false
  if (
    !coachingInsights ||
    typeof coachingInsights !== 'object' ||
    Array.isArray(coachingInsights) ||
    typeof (coachingInsights as Record<string, unknown>).error === 'string'
  ) {
    return false
  }
  const scores = (skillScores as Record<string, unknown>).scores
  return Boolean(
    scores &&
      typeof scores === 'object' &&
      !Array.isArray(scores) &&
      Object.values(scores as Record<string, unknown>).some(
        (score) => typeof score === 'number' && Number.isFinite(score),
      ),
  )
}

function clarification(
  turns: Array<{ kind: string | null; payload: Prisma.JsonValue }>,
): string | null {
  const latest = turns[0]
  if (!latest || latest.kind !== 'clarify') return null
  if (!latest.payload || typeof latest.payload !== 'object' || Array.isArray(latest.payload)) {
    return null
  }
  const payload = latest.payload as Record<string, unknown>
  if (payload.answered === true) return null
  return typeof payload.question === 'string' && payload.question.trim()
    ? payload.question.trim()
    : null
}

function focusLabel(skill: string): string {
  return skill
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function pulseCandidatesFromRows(
  rows: Array<{
    skill: string
    score: number
    sessionId: string | null
    recordedAt?: Date
  }>,
): PulseCandidate[] {
  const bySkill = new Map<string, { score: number; sessions: Set<string> }>()
  const newestFirst = [...rows].sort(
    (a, b) => (b.recordedAt?.getTime() ?? 0) - (a.recordedAt?.getTime() ?? 0),
  )
  for (const row of newestFirst) {
    if (!row.sessionId || !isCoachFocusArea(row.skill)) continue
    const current = bySkill.get(row.skill)
    if (current) current.sessions.add(row.sessionId)
    else bySkill.set(row.skill, { score: row.score, sessions: new Set([row.sessionId]) })
  }
  return [...bySkill.entries()].flatMap(([skill, value]) => {
    if (
      !isCoachFocusArea(skill) ||
      skill === 'snapshot' ||
      value.sessions.size < MIN_PULSE_SESSIONS ||
      value.score >= 7
    ) {
      return []
    }
    const label = focusLabel(skill)
    return [{
      kind: 'pulse' as const,
      threadId: null,
      skill,
      score: Math.round(value.score * 10) / 10,
      sessions: value.sessions.size,
      practiceAvailable: true,
      goalTitle: `Improve ${label}`.slice(0, 60),
      title: `Strengthen your ${label.toLowerCase()}`,
      reason: `${value.sessions.size} tracked measurement${value.sessions.size === 1 ? '' : 's'} · latest score ${value.score.toFixed(1)}/10`,
    }]
  })
}

async function resultThreadId(
  userId: string,
  module: 'elevate' | 'replay',
  targetId: string,
): Promise<string | null> {
  const action = await prisma.coachAction.findFirst({
    where: { targetId, module, thread: { userId } },
    orderBy: { createdAt: 'desc' },
    select: { threadId: true },
  })
  if (action) return action.threadId

  const kind = module === 'replay' ? 'replay-result' : 'elevate-result'
  const turn = await prisma.coachTurn.findFirst({
    where: {
      kind,
      thread: { userId },
      payload: { path: ['sessionId'], equals: targetId },
    },
    orderBy: { createdAt: 'desc' },
    select: { threadId: true },
  })
  return turn?.threadId ?? null
}

export async function loadCoachHome(userId: string): Promise<{
  recommendation: CoachHomeRecommendation
}> {
  const enabled = await getEnabledFeatures()
  const pulseSources = enabled.filter(
    (feature): feature is 'elevate' | 'replay' =>
      feature === 'elevate' || feature === 'replay',
  )
  const now = Date.now()
  const resultSince = new Date(now - RESULT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const pulseSince = new Date(now - PULSE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const liveSince = new Date(now - LIVE_RESUME_HOURS * 60 * 60 * 1000)

  const [elevateRows, liveElevateRows, replayRows, threadRows, preparationRows, pulseRows] =
    await Promise.all([
      enabled.includes('elevate')
        ? prisma.session.findMany({
            where: {
              userId,
              module: 'elevate',
              endedAt: { gte: resultSince },
              metrics: { isNot: null },
            },
            orderBy: { endedAt: 'desc' },
            select: {
              id: true,
              sessionName: true,
              focusArea: true,
              endedAt: true,
              metrics: { select: { coachingInsights: true, skillScores: true } },
            },
          })
        : Promise.resolve([]),
      enabled.includes('elevate')
        ? prisma.session.findMany({
            where: {
              userId,
              module: 'elevate',
              endedAt: null,
              startedAt: { gte: liveSince },
            },
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: {
              id: true,
              sessionName: true,
              focusArea: true,
              startedAt: true,
            },
          })
        : Promise.resolve([]),
      enabled.includes('replay')
        ? prisma.replaySession.findMany({
            where: {
              userId,
              status: 'completed',
              result: { is: { createdAt: { gte: resultSince } } },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              sessionName: true,
              meetingType: true,
              result: {
                select: {
                  overallScore: true,
                  coachingInsights: true,
                  createdAt: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      prisma.coachThread.findMany({
        where: { userId, status: 'active' },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          focusArea: true,
          updatedAt: true,
          turns: {
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: { kind: true, payload: true },
          },
        },
      }),
      enabled.includes('prepare')
        ? prisma.preparation.findMany({
            where: {
              userId,
              status: 'ACTIVE',
              stages: {
                some: {
                  status: { in: ['SCHEDULED', 'UPCOMING'] },
                  scheduledAt: { gte: new Date(now - 24 * 60 * 60 * 1000) },
                },
              },
            },
            orderBy: { updatedAt: 'desc' },
            select: {
              id: true,
              title: true,
              interview: { select: { companyName: true, roleTitle: true } },
              stages: {
                where: {
                  status: { in: ['SCHEDULED', 'UPCOMING'] },
                  scheduledAt: { gte: new Date(now - 24 * 60 * 60 * 1000) },
                },
                orderBy: [{ scheduledAt: 'asc' }, { sequence: 'asc' }],
                take: 1,
                select: { id: true, name: true, scheduledAt: true },
              },
              coachThreads: {
                where: { status: 'active' },
                orderBy: { updatedAt: 'desc' },
                take: 1,
                select: { id: true },
              },
            },
          })
        : Promise.resolve([]),
      pulseSources.length > 0
        ? prisma.progressPulse.findMany({
            where: {
              userId,
              source: { in: pulseSources },
              recordedAt: { gte: pulseSince },
              sessionId: { not: null },
            },
            orderBy: { recordedAt: 'desc' },
            select: { skill: true, score: true, sessionId: true, recordedAt: true },
          })
        : Promise.resolve([]),
    ])

  const results: ResultCandidate[] = [
    ...elevateRows.flatMap((row) =>
      row.endedAt &&
      hasReadyElevateResult(
        row.metrics?.skillScores ?? null,
        row.metrics?.coachingInsights ?? null,
      )
        ? [{
            kind: 'result' as const,
            module: 'elevate' as const,
            targetId: row.id,
            threadId: null,
            title: 'Your Elevate practice is ready',
            reason: row.focusArea
              ? `${focusLabel(row.focusArea)} practice completed`
              : row.sessionName || 'Practice completed',
            insight: jsonText(row.metrics?.coachingInsights ?? null, 'topStrength'),
            completedAt: row.endedAt.toISOString(),
          }]
        : [],
    ),
    ...replayRows.flatMap((row) =>
      row.result
        ? [{
            kind: 'result' as const,
            module: 'replay' as const,
            targetId: row.id,
            threadId: null,
            title: 'Your Replay analysis is ready',
            reason: `${row.sessionName || row.meetingType} · ${row.result.overallScore.toFixed(1)}/10`,
            insight: jsonText(row.result.coachingInsights ?? null, 'topStrength'),
            completedAt: row.result.createdAt.toISOString(),
          }]
        : [],
    ),
  ]

  const receipts = results.length > 0
    ? await prisma.coachHomeResultReceipt.findMany({
        where: {
          userId,
          OR: results.map((result) => ({
            module: result.module,
            targetId: result.targetId,
          })),
        },
        select: { module: true, targetId: true },
      })
    : []
  const seenResults = new Set(
    receipts.map((receipt) => `${receipt.module}:${receipt.targetId}`),
  )
  const latestResult = results
    .filter((result) => !seenResults.has(`${result.module}:${result.targetId}`))
    .sort(
    (a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt),
    )[0]
  if (latestResult) {
    latestResult.threadId = await resultThreadId(
      userId,
      latestResult.module,
      latestResult.targetId,
    )
  }

  const liveSessions: LiveResumeCandidate[] = await Promise.all(
    liveElevateRows.map(async (row) => ({
      kind: 'live-resume' as const,
      module: 'elevate' as const,
      targetId: row.id,
      threadId: await resultThreadId(userId, 'elevate', row.id),
      title: 'Resume your Elevate session',
      reason: row.focusArea
        ? `${focusLabel(row.focusArea)} practice is still in progress`
        : `${row.sessionName || 'Practice'} is still in progress`,
      startedAt: row.startedAt.toISOString(),
    })),
  )

  const resumes: ResumeCandidate[] = threadRows.flatMap((row) => {
    if (row.updatedAt < resultSince) return []
    const question = clarification(row.turns)
    return question
      ? [{
          kind: 'resume' as const,
          threadId: row.id,
          title: row.title?.trim() || 'Resume coaching',
          question,
          updatedAt: row.updatedAt.toISOString(),
        }]
      : []
  })

  const preparations: PrepareCandidate[] = preparationRows.flatMap((row) => {
    const stage = row.stages[0]
    if (!stage?.scheduledAt) return []
    const company = row.interview?.companyName || row.title
    return [{
      kind: 'prepare' as const,
      threadId: row.coachThreads[0]?.id ?? null,
      preparationId: row.id,
      stageId: stage.id,
      stageName: stage.name,
      goalTitle: `${company} ${stage.name} preparation`.slice(0, 60),
      title: `Practise for your ${stage.name} round`,
      reason: `${company} · ${stage.name} scheduled`,
      scenario: `Prepare for the ${stage.name} round for ${company}.`,
      scheduledAt: stage.scheduledAt.toISOString(),
    }]
  })

  const focusThreads = new Map<string, string>()
  for (const row of threadRows) {
    if (row.focusArea && !focusThreads.has(row.focusArea)) {
      focusThreads.set(row.focusArea, row.id)
    }
  }
  const pulse = pulseCandidatesFromRows(pulseRows).map((candidate) => ({
    ...candidate,
    practiceAvailable: enabled.includes('elevate'),
    threadId: focusThreads.get(candidate.skill) ?? null,
  }))

  return {
    recommendation: selectCoachHomeRecommendation({
      results: latestResult ? [latestResult] : [],
      liveSessions,
      resumes,
      preparations,
      pulse,
    }),
  }
}

export async function markCoachHomeResultSeen(
  userId: string,
  module: 'elevate' | 'replay',
  targetId: string,
): Promise<boolean> {
  const owned =
    module === 'elevate'
      ? await prisma.session.findFirst({
          where: { id: targetId, userId, module: 'elevate', endedAt: { not: null } },
          select: { id: true },
        })
      : await prisma.replaySession.findFirst({
          where: { id: targetId, userId, status: 'completed' },
          select: { id: true },
        })
  if (!owned) return false

  await prisma.coachHomeResultReceipt.upsert({
    where: {
      userId_module_targetId: { userId, module, targetId },
    },
    create: { userId, module, targetId },
    update: { seenAt: new Date() },
  })
  return true
}
