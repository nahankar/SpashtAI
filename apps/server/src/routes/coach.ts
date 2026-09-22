import { Router, type Request, type Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { generateCoachResponse, interpretCoachResult } from '../coach/service'
import type { CoachHistoryTurn, CompletedSessionSummary } from '../coach/prompt'
import { mergeCoachTurnPayload } from '../coach/turn-sync'
import { loadCoachHome, markCoachHomeResultSeen } from '../coach/home'
import { isCoachFocusArea } from '../coach/focusAreas'
import { assessPaceEvidence, readPersistedPaceEvidence } from '../analytics/pace'

const router = Router()
const MAX_TURNS = 40
const MAX_TEXT = 2000
const TURN_KINDS = new Set([
  'confirm',
  'route-confirm',
  'intent',
  'elevate-result',
  'replay-result',
  'goal-propose',
  'reply',
  'clarify',
  'recommend',
  'result-insight',
  'pulse-evidence',
])

/** How much of the thread Coach sees. Enough to resolve "pitch for vc" against an
 *  earlier "I have a presentation", without sending the whole history every turn. */
const HISTORY_TURNS = 12
const HISTORY_TEXT = 500
const MAX_MESSAGE = 1000

function userId(req: Request): string {
  return (req as Request & { user?: { userId: string } }).user!.userId
}

router.get('/home', async (req: Request, res: Response) => {
  try {
    res.json(await loadCoachHome(userId(req)))
  } catch (error) {
    console.error('load coach home', error)
    res.status(500).json({ error: 'Failed to load Coach Home' })
  }
})

router.post('/home/results/:module/:id/seen', async (req: Request, res: Response) => {
  try {
    if (req.params.module !== 'elevate' && req.params.module !== 'replay') {
      return res.status(400).json({ error: 'Unknown result module' })
    }
    const targetId = req.params.id.trim().slice(0, 80)
    if (!targetId) return res.status(400).json({ error: 'Result id is required' })
    const seen = await markCoachHomeResultSeen(
      userId(req),
      req.params.module,
      targetId,
    )
    if (!seen) return res.status(404).json({ error: 'Result not found' })
    res.json({ seen: true })
  } catch (error) {
    console.error('mark coach home result seen', error)
    res.status(500).json({ error: 'Failed to update Coach Home' })
  }
})

function serializeThread(thread: {
  id: string
  title: string | null
  status: string
  preparationId: string | null
  focusArea: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    preparationId: thread.preparationId,
    focusArea: thread.focusArea,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  }
}

function serializeTurn(turn: {
  id: string
  role: string
  kind: string | null
  text: string | null
  payload: Prisma.JsonValue
  createdAt: Date
}) {
  return {
    id: turn.id,
    role: turn.role,
    kind: turn.kind,
    text: turn.text,
    payload: turn.payload,
    createdAt: turn.createdAt.toISOString(),
  }
}

async function ownedThread(req: Request, res: Response) {
  const thread = await prisma.coachThread.findFirst({
    where: { id: req.params.id, userId: userId(req) },
  })
  if (!thread) {
    res.status(404).json({ error: 'Thread not found' })
    return null
  }
  return thread
}

router.get('/threads', async (req: Request, res: Response) => {
  try {
    const threads = await prisma.coachThread.findMany({
      where: { userId: userId(req) },
      orderBy: { updatedAt: 'desc' },
    })
    res.json({ threads: threads.map(serializeThread) })
  } catch (error) {
    console.error('list coach threads', error)
    res.status(500).json({ error: 'Failed to list coach threads' })
  }
})

router.post('/threads', async (req: Request, res: Response) => {
  try {
    const title =
      typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 80) : ''
    const focusArea = isCoachFocusArea(req.body?.focusArea) ? req.body.focusArea : null
    const thread = await prisma.coachThread.create({
      data: {
        userId: userId(req),
        title: title || null,
        focusArea,
        status: 'active',
      },
    })
    res.status(201).json({ thread: serializeThread(thread), turns: [] })
  } catch (error) {
    console.error('create coach thread', error)
    res.status(500).json({ error: 'Failed to create coach thread' })
  }
})

router.get('/threads/:id', async (req: Request, res: Response) => {
  try {
    const thread = await ownedThread(req, res)
    if (!thread) return
    const [turns, actions] = await Promise.all([
      prisma.coachTurn.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: 'desc' },
        take: MAX_TURNS,
      }),
      prisma.coachAction.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    res.json({
      thread: serializeThread(thread),
      turns: turns.reverse().map(serializeTurn),
      actions: actions.map((action) => ({
        id: action.id,
        module: action.module,
        action: action.action,
        targetId: action.targetId,
        createdAt: action.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('get coach thread', error)
    res.status(500).json({ error: 'Failed to load coach thread' })
  }
})

router.patch('/threads/:id', async (req: Request, res: Response) => {
  try {
    const thread = await ownedThread(req, res)
    if (!thread) return
    const data: {
      title?: string | null
      status?: string
      preparationId?: string | null
      focusArea?: string | null
    } = {}
    if (typeof req.body?.title === 'string') {
      const title = req.body.title.trim().slice(0, 80)
      data.title = title || null
    }
    if (req.body?.status === 'active' || req.body?.status === 'archived') {
      data.status = req.body.status
    }
    if (req.body?.preparationId === null) {
      data.preparationId = null
    } else if (typeof req.body?.preparationId === 'string') {
      const preparationId = req.body.preparationId.trim()
      const preparation = await prisma.preparation.findFirst({
        where: { id: preparationId, userId: userId(req) },
        select: { id: true },
      })
      if (!preparation) {
        return res.status(400).json({ error: 'Preparation not found' })
      }
      data.preparationId = preparation.id
    }
    if (req.body?.focusArea === null) {
      data.focusArea = null
    } else if (isCoachFocusArea(req.body?.focusArea)) {
      data.focusArea = req.body.focusArea
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }
    const updated = await prisma.coachThread.update({
      where: { id: thread.id },
      data,
    })
    res.json({ thread: serializeThread(updated) })
  } catch (error) {
    console.error('patch coach thread', error)
    res.status(500).json({ error: 'Failed to update coach thread' })
  }
})

router.delete('/threads/:id', async (req: Request, res: Response) => {
  try {
    const thread = await ownedThread(req, res)
    if (!thread) return
    await prisma.coachThread.delete({ where: { id: thread.id } })
    res.json({ deleted: true })
  } catch (error) {
    console.error('delete coach thread', error)
    res.status(500).json({ error: 'Failed to delete coach thread' })
  }
})

router.put('/threads/:id/turns', async (req: Request, res: Response) => {
  try {
    const thread = await ownedThread(req, res)
    if (!thread) return
    const incoming = Array.isArray(req.body?.turns) ? req.body.turns : null
    if (!incoming) {
      return res.status(400).json({ error: 'turns array is required' })
    }
    type SavedTurn = {
      id: string
      role: string
      kind: string | null
      text: string | null
      payload: Prisma.InputJsonValue | typeof Prisma.JsonNull
      createdAt?: Date
      position: number
    }
    const turns: SavedTurn[] = incoming.slice(-MAX_TURNS).flatMap((item: Record<string, unknown>, position: number) => {
      const id = typeof item.id === 'string' && item.id.length < 80 ? item.id : null
      if (!id) return []
      const role = item.role === 'user' ? 'user' : item.role === 'coach' ? 'coach' : null
      if (!role) return []
      const kind =
        typeof item.kind === 'string' && TURN_KINDS.has(item.kind) ? item.kind : null
      if (role === 'coach' && !kind) return []
      const text =
        typeof item.text === 'string' ? item.text.trim().slice(0, MAX_TEXT) : null
      const payload =
        item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
          ? (item.payload as Prisma.InputJsonObject)
          : Prisma.JsonNull
      const createdAt =
        typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt))
          ? new Date(item.createdAt)
          : undefined
      return [
        {
          id,
          role,
          kind,
          text,
          payload,
          createdAt,
          position,
        },
      ]
    })

    const saved = await prisma.$transaction(async (tx) => {
      // Updating the parent first serializes saves for this thread in Postgres.
      // Each request then merges against the latest committed payload instead
      // of replacing the whole transcript with its browser snapshot.
      await tx.coachThread.update({
        where: { id: thread.id },
        data: { updatedAt: new Date() },
      })

      const existing = await tx.coachTurn.findMany({
        where: { threadId: thread.id, id: { in: turns.map((turn) => turn.id) } },
      })
      const byId = new Map(existing.map((turn) => [turn.id, turn]))
      const missing = turns.filter((turn) => !byId.has(turn.id))

      if (missing.length > 0) {
        await tx.coachTurn.createMany({
          data: missing.map((turn, index) => ({
            id: turn.id,
            threadId: thread.id,
            role: turn.role,
            kind: turn.kind,
            text: turn.text,
            payload: turn.payload,
            createdAt: turn.createdAt
              ? new Date(turn.createdAt.getTime() + turn.position)
              : new Date(Date.now() - (missing.length - index) * 10),
          })),
          skipDuplicates: true,
        })
      }

      await Promise.all(
        turns.flatMap((turn) => {
          const previous = byId.get(turn.id)
          if (!previous) return []
          return [
            tx.coachTurn.update({
              where: { id: previous.id },
              data: {
                text: turn.text,
                payload: mergeCoachTurnPayload(previous.payload, turn.payload),
              },
            }),
          ]
        }),
      )

      const latest = await tx.coachTurn.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: 'desc' },
        take: MAX_TURNS,
      })
      return latest.reverse()
    })
    res.json({ turns: saved.map(serializeTurn) })
  } catch (error) {
    console.error('save coach turns', error)
    res.status(500).json({ error: 'Failed to save coach turns' })
  }
})

function parseHistory(raw: unknown): CoachHistoryTurn[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(-HISTORY_TURNS)
    .flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') return []
      const entry = item as Record<string, unknown>
      const role = entry.role === 'user' ? 'user' : entry.role === 'coach' ? 'coach' : null
      const value = typeof entry.text === 'string' ? entry.text.trim() : ''
      if (!role || !value) return []
      return [{ role, text: value.slice(0, HISTORY_TEXT) }]
    })
}

async function firstNameFor(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, email: true },
  })
  const name = user?.firstName?.trim()
  if (name && name.toLowerCase() !== 'admin') return name
  return user?.email?.split('@')[0] ?? 'there'
}

/**
 * Coach's conversational turn. The client owns turn persistence; this endpoint
 * only updates thread metadata when Coach binds the goal to an owned preparation.
 *
 * Returns 204 when the LLM is unavailable or unusable so the client can fall
 * back to rule-based routing rather than surfacing an error.
 */
router.post('/threads/:id/respond', async (req: Request, res: Response) => {
  try {
    const thread = await ownedThread(req, res)
    if (!thread) return

    const message =
      typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, MAX_MESSAGE) : ''
    if (!message) {
      return res.status(400).json({ error: 'message is required' })
    }

    const result = await generateCoachResponse({
      userId: userId(req),
      firstName: await firstNameFor(userId(req)),
      history: parseHistory(req.body?.history),
      message,
      mustRecommend: req.body?.answeringClarification === true,
      goalTitle: thread.title?.trim() || null,
      preparationId: thread.preparationId,
    })

    if (!result) return res.status(204).end()
    const recommendedPreparationId = result.response.recommend?.brief.preparationId
    if (recommendedPreparationId && recommendedPreparationId !== thread.preparationId) {
      await prisma.coachThread.update({
        where: { id: thread.id },
        data: { preparationId: recommendedPreparationId },
      })
    }
    res.json(result.response)
  } catch (error) {
    console.error('coach respond', error)
    res.status(500).json({ error: 'Failed to generate coach response' })
  }
})

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readSkillScores(
  raw: Prisma.JsonValue | null,
  includePacing = true,
): Array<{ skill: string; score: number }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const scores = (raw as Record<string, unknown>).scores
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return []
  return Object.entries(scores as Record<string, unknown>)
    .filter(([skill]) => includePacing || skill !== 'pacing')
    .map(([skill, score]) => ({ skill, score: numberOrNull(score) }))
    .filter((entry): entry is { skill: string; score: number } => entry.score != null)
}

function readCoachingText(raw: Prisma.JsonValue | null, key: string): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = (raw as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function summariseElevateSession(
  sessionId: string,
  ownerId: string,
): Promise<CompletedSessionSummary | null> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId: ownerId, discardedAt: null },
    include: { metrics: true },
  })
  if (!session) return null
  const persistedPace = readPersistedPaceEvidence(session.metrics?.processingStatus)
  const expectedWords =
    persistedPace && typeof persistedPace === 'object'
      ? Number((persistedPace as Record<string, unknown>).totalWords) || 0
      : 0
  const paceAvailable =
    assessPaceEvidence(persistedPace, expectedWords).status === 'available'
  return {
    module: 'elevate',
    focusArea: session.focusArea,
    durationSec: session.durationSec,
    wpm: paceAvailable ? numberOrNull(session.metrics?.userWpm) : null,
    fillerRate: numberOrNull(session.metrics?.userFillerRate),
    skillScores: readSkillScores(session.metrics?.skillScores ?? null, paceAvailable),
    topStrength: readCoachingText(session.metrics?.coachingInsights ?? null, 'topStrength'),
    primaryImprovement: readCoachingText(
      session.metrics?.coachingInsights ?? null,
      'primaryImprovement',
    ),
  }
}

async function summariseReplaySession(
  sessionId: string,
  ownerId: string,
): Promise<CompletedSessionSummary | null> {
  const replay = await prisma.replaySession.findFirst({
    where: { id: sessionId, userId: ownerId },
    include: { result: true },
  })
  if (!replay?.result) return null
  return {
    module: 'replay',
    focusArea: replay.focusAreas[0] ?? null,
    durationSec: null,
    wpm: numberOrNull(replay.result.wordsPerMinute),
    fillerRate: numberOrNull(replay.result.fillerWordRate),
    skillScores: readSkillScores(replay.result.skillScores ?? null),
    topStrength: readCoachingText(replay.result.coachingInsights ?? null, 'topStrength'),
    primaryImprovement: readCoachingText(
      replay.result.coachingInsights ?? null,
      'primaryImprovement',
    ),
  }
}

/**
 * The return loop: read a finished session and say what it means for the goal
 * and what to do next. Uses the stronger model, so it is a separate call the
 * client makes once when a result lands back in the thread.
 */
router.post('/threads/:id/interpret', async (req: Request, res: Response) => {
  try {
    const thread = await ownedThread(req, res)
    if (!thread) return

    const sessionId =
      typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim().slice(0, 80) : ''
    const moduleName = req.body?.module === 'replay' ? 'replay' : 'elevate'
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' })
    }

    const owner = userId(req)
    const session =
      moduleName === 'replay'
        ? await summariseReplaySession(sessionId, owner)
        : await summariseElevateSession(sessionId, owner)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const response = await interpretCoachResult({
      userId: owner,
      goalTitle: thread.title,
      preparationId: thread.preparationId,
      session,
    })
    if (!response) return res.status(204).end()
    res.json(response)
  } catch (error) {
    console.error('coach interpret', error)
    res.status(500).json({ error: 'Failed to interpret session' })
  }
})

router.post('/threads/:id/actions', async (req: Request, res: Response) => {
  try {
    const thread = await ownedThread(req, res)
    if (!thread) return
    const moduleName =
      typeof req.body?.module === 'string' ? req.body.module.trim().slice(0, 40) : ''
    const action =
      typeof req.body?.action === 'string' ? req.body.action.trim().slice(0, 40) : ''
    const targetId =
      typeof req.body?.targetId === 'string' ? req.body.targetId.trim().slice(0, 80) : null
    if (!moduleName || !action) {
      return res.status(400).json({ error: 'module and action are required' })
    }
    const created = await prisma.coachAction.create({
      data: {
        threadId: thread.id,
        module: moduleName,
        action,
        targetId: targetId || null,
      },
    })
    await prisma.coachThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
    })
    res.status(201).json({
      action: {
        id: created.id,
        module: created.module,
        action: created.action,
        targetId: created.targetId,
        createdAt: created.createdAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('record coach action', error)
    res.status(500).json({ error: 'Failed to record coach action' })
  }
})

export default router
