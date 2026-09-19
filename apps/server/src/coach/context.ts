import { prisma } from '../lib/prisma'

/**
 * The cross-module picture Coach reasons over. Deliberately small and already
 * summarised: this is serialised into a prompt on every turn, so raw transcripts
 * and full metric blobs stay out of it.
 */
export interface CoachContext {
  pulse: PulseSkill[]
  preparation: PreparationContext | null
  lastElevate: ElevateContext | null
  lastReplay: ReplayContext | null
}

export interface PulseSkill {
  skill: string
  score: number
  /** Change against the preceding measurement, null when there is only one. */
  delta: number | null
  sessions: number
}

export interface PreparationContext {
  id: string
  title: string
  company: string | null
  role: string | null
  interviewDate: string | null
  nextStage: { id: string; name: string; type: string; scheduledAt: string | null } | null
}

export interface ElevateContext {
  sessionId: string
  focusArea: string | null
  endedAt: string | null
  durationSec: number | null
  wpm: number | null
  fillerRate: number | null
}

export interface ReplayContext {
  sessionId: string
  name: string | null
  meetingType: string | null
  createdAt: string
  wpm: number | null
  fillerRate: number | null
  longestMonologueSec: number | null
}

/** Pulse rows older than this are not useful for "what are you working on now". */
const PULSE_WINDOW_DAYS = 90
const PULSE_MAX_ROWS = 400

function round(value: number | null | undefined, digits = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

async function loadPulse(userId: string): Promise<PulseSkill[]> {
  const since = new Date(Date.now() - PULSE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const rows = await prisma.progressPulse.findMany({
    where: { userId, recordedAt: { gte: since } },
    orderBy: { recordedAt: 'desc' },
    select: { skill: true, score: true },
    take: PULSE_MAX_ROWS,
  })

  const bySkill = new Map<string, number[]>()
  for (const row of rows) {
    const scores = bySkill.get(row.skill)
    if (scores) scores.push(row.score)
    else bySkill.set(row.skill, [row.score])
  }

  return [...bySkill.entries()]
    .map(([skill, scores]) => ({
      skill,
      score: round(scores[0])!,
      delta: scores.length > 1 ? round(scores[0] - scores[1]) : null,
      sessions: scores.length,
    }))
    .sort((a, b) => a.score - b.score)
}

async function loadPreparation(
  userId: string,
  preparationId?: string | null,
): Promise<PreparationContext | null> {
  const prep = await prisma.preparation.findFirst({
    where: preparationId ? { id: preparationId, userId } : { userId, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    include: {
      interview: true,
      stages: {
        where: { status: { in: ['SCHEDULED', 'UPCOMING'] } },
        // A scheduled round outranks an undated one regardless of sequence.
        orderBy: [{ scheduledAt: 'asc' }, { sequence: 'asc' }],
        take: 1,
      },
    },
  })
  if (!prep) return null

  const stage = prep.stages[0] ?? null
  return {
    id: prep.id,
    title: prep.title,
    company: prep.interview?.companyName ?? null,
    role: prep.interview?.roleTitle ?? null,
    interviewDate: prep.interview?.interviewDate?.toISOString() ?? null,
    nextStage: stage
      ? {
          id: stage.id,
          name: stage.name,
          type: stage.type,
          scheduledAt: stage.scheduledAt?.toISOString() ?? null,
        }
      : null,
  }
}

async function loadLastElevate(userId: string): Promise<ElevateContext | null> {
  const session = await prisma.session.findFirst({
    where: { userId, module: 'elevate', endedAt: { not: null } },
    orderBy: { startedAt: 'desc' },
    include: { metrics: true },
  })
  if (!session) return null

  return {
    sessionId: session.id,
    focusArea: session.focusArea,
    endedAt: session.endedAt?.toISOString() ?? null,
    durationSec: session.durationSec,
    wpm: round(session.metrics?.userWpm),
    fillerRate: round(session.metrics?.userFillerRate),
  }
}

async function loadLastReplay(userId: string): Promise<ReplayContext | null> {
  const replay = await prisma.replaySession.findFirst({
    where: { userId, status: 'completed' },
    orderBy: { createdAt: 'desc' },
    include: { result: true },
  })
  if (!replay) return null

  return {
    sessionId: replay.id,
    name: replay.sessionName,
    meetingType: replay.meetingType,
    createdAt: replay.createdAt.toISOString(),
    wpm: round(replay.result?.wordsPerMinute),
    fillerRate: round(replay.result?.fillerWordRate),
    longestMonologueSec: replay.result?.longestMonologueSec ?? null,
  }
}

/**
 * Assembles everything Coach knows about the user. Each source is independent,
 * so one failing query degrades that section to null rather than the whole turn.
 */
export async function buildCoachContext(
  userId: string,
  preparationId?: string | null,
): Promise<CoachContext> {
  const [pulse, preparation, lastElevate, lastReplay] = await Promise.all([
    loadPulse(userId).catch(() => [] as PulseSkill[]),
    loadPreparation(userId, preparationId).catch(() => null),
    loadLastElevate(userId).catch(() => null),
    loadLastReplay(userId).catch(() => null),
  ])
  return { pulse, preparation, lastElevate, lastReplay }
}
