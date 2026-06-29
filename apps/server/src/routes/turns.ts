import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import {
  exportDenied,
  getElevateSessionOwnerId,
  resolveRequestExportFlags,
} from '../lib/userExportFlags'
import { dedupeConversationMessages } from '../lib/dedupeMessages'
import { alignTurnsToAudio } from '../lib/audioAlignment'
import { resolveElevateSessionAudio } from '../analytics/insightProviders/resolveSessionAudio'

const INTERNAL_AGENT_TOKEN =
  process.env.INTERNAL_AGENT_TOKEN?.trim() ||
  (process.env.NODE_ENV !== 'production' ? 'dev-internal-agent-token' : '')

interface IncomingTurn {
  turnIndex: number
  role: string
  text: string
  audioStart?: number | null
  audioEnd?: number | null
  words?: unknown
  metrics?: unknown
  score?: unknown
  coachNote?: string | null
}

/**
 * User-facing: fetch the per-turn records that power the Session Replay UI.
 * Returns the shared audio anchor (recordingStartedAt) so the client can seek.
 */
export async function getSessionTurns(req: Request, res: Response) {
  try {
    const { sessionId } = req.params

    const ownerId = await getElevateSessionOwnerId(sessionId)
    const { flags, accessDenied } = await resolveRequestExportFlags(req, ownerId)
    if (accessDenied) {
      return exportDenied(res, 'Access denied')
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        recordingStartedAt: true,
        module: true,
        sessionName: true,
        focusArea: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
      },
    })

    let turns: any[] = await prisma.sessionTurn.findMany({
      where: { sessionId },
      orderBy: { turnIndex: 'asc' },
    })

    // Graceful degradation: if no per-turn rows were captured (e.g. sessions
    // recorded before this feature, or the agent didn't persist them), synthesize
    // lightweight turns from the saved transcript so playback still shows the
    // conversation + audio (no per-message offsets/metrics in this mode).
    let degraded = false
    if (turns.length === 0) {
      const transcript = await prisma.sessionTranscript.findUnique({
        where: { sessionId },
        select: { conversationData: true },
      })
      const conv = transcript?.conversationData as any
      const rawMessages: any[] = Array.isArray(conv?.messages)
        ? conv.messages
        : Array.isArray(conv?.conversation)
          ? conv.conversation
          : []
      const messages = dedupeConversationMessages(rawMessages)
      if (messages.length > 0) {
        degraded = true
        turns = messages
          .filter((m) => (m?.content || m?.text) && (m?.role || m?.speaker))
          .map((m, i) => ({
            id: `synthetic_${i}`,
            sessionId,
            turnIndex: i,
            role: m.role || m.speaker,
            text: m.content || m.text || '',
            audioStart: null,
            audioEnd: null,
            words: null,
            metrics: null,
            score: null,
            coachNote: null,
            createdAt: null,
          }))
      }
    }

    // Respect per-user transcript-text restriction: blank the text + words but
    // keep the numeric metrics/scores so the analytics still render.
    const sanitized = flags.hideTranscriptText
      ? turns.map((t) => ({ ...t, text: '', words: null }))
      : turns

    res.json({
      sessionId,
      recordingStartedAt: session?.recordingStartedAt ?? null,
      transcriptHidden: flags.hideTranscriptText,
      degraded,
      session: session
        ? {
            module: session.module,
            sessionName: session.sessionName,
            focusArea: session.focusArea,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            durationSec: session.durationSec,
          }
        : null,
      turns: sanitized,
    })
  } catch (error) {
    console.error('Error getting session turns:', error)
    res.status(500).json({ error: 'Failed to get session turns' })
  }
}

/**
 * Internal (agent-only): batch upsert per-turn records at session end.
 * Idempotent on (sessionId, turnIndex) so a retry can't duplicate rows.
 */
export async function saveSessionTurnsForAgent(req: Request, res: Response) {
  try {
    const token = req.header('x-internal-agent-token')
    if (!token || token !== INTERNAL_AGENT_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized internal agent request' })
    }

    const { sessionId } = req.params
    const turns = (req.body?.turns ?? []) as IncomingTurn[]
    if (!Array.isArray(turns) || turns.length === 0) {
      return res.status(400).json({ error: 'turns[] is required' })
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    // Primary alignment: derive per-turn timings straight from the recording.
    // The user's mic track is the ground truth — ffmpeg silencedetect finds the
    // exact speech regions, which we snap each user turn onto. This is immune to
    // the STT word-clock's blind spots (it strips greeting lead-in and the
    // coach's speaking gaps, so a single shift can't align later turns).
    let alignmentInfo = 'audio: none'
    let alignedById: Map<number, IncomingTurn> | null = null
    try {
      const resolved = await resolveElevateSessionAudio(sessionId)
      if (resolved?.audioPath) {
        const result = await alignTurnsToAudio(turns as any, resolved.audioPath)
        alignmentInfo = `audio: aligned=${result.aligned} regions=${result.regionCount} userTurns=${result.userTurnCount}`
        if (result.aligned) {
          alignedById = new Map(
            (result.turns as IncomingTurn[]).map((t) => [t.turnIndex, t]),
          )
        }
      }
    } catch (err) {
      alignmentInfo = `audio: error ${String((err as Error)?.message ?? err)}`
    }

    // Fallback: realign the STT timeline onto the recording timeline with a
    // single per-session shift = (sttT0 − recordingStartedAt). Only used when
    // audio-onset alignment is unavailable (no recording yet / ffmpeg missing /
    // region count didn't match the user-turn count).
    const sttEpochMs = Number(req.body?.sttEpochMs)
    let shiftSec = 0
    if (Number.isFinite(sttEpochMs) && session.recordingStartedAt) {
      shiftSec = sttEpochMs / 1000 - session.recordingStartedAt.getTime() / 1000
      if (!Number.isFinite(shiftSec)) shiftSec = 0
    }
    console.log(
      `[turns] ${sessionId} align (${alignmentInfo}); fallback shift=${shiftSec.toFixed(
        2,
      )}s (sttEpochMs=${Number.isFinite(sttEpochMs) ? sttEpochMs : 'none'} recordingStartedAt=${
        session.recordingStartedAt?.toISOString() ?? 'none'
      })`,
    )
    const shiftTime = (v: number | null | undefined): number | null =>
      v == null ? null : Math.max(0, v + shiftSec)
    const shiftWords = (words: unknown): unknown => {
      if (!Array.isArray(words) || shiftSec === 0) return words ?? undefined
      return words.map((w: any) =>
        w && typeof w === 'object'
          ? { ...w, start: Math.max(0, (w.start ?? 0) + shiftSec), end: Math.max(0, (w.end ?? 0) + shiftSec) }
          : w,
      )
    }

    let saved = 0
    for (const t of turns) {
      if (typeof t.turnIndex !== 'number' || !t.role || typeof t.text !== 'string') {
        continue
      }
      const a = alignedById?.get(t.turnIndex)
      const data = a
        ? {
            role: t.role,
            text: t.text,
            audioStart: a.audioStart ?? null,
            audioEnd: a.audioEnd ?? null,
            words: (a.words ?? undefined) as any,
            metrics: (t.metrics ?? undefined) as any,
            score: (t.score ?? undefined) as any,
            coachNote: t.coachNote ?? null,
          }
        : {
            role: t.role,
            text: t.text,
            audioStart: shiftTime(t.audioStart),
            audioEnd: shiftTime(t.audioEnd),
            words: shiftWords(t.words) as any,
            metrics: (t.metrics ?? undefined) as any,
            score: (t.score ?? undefined) as any,
            coachNote: t.coachNote ?? null,
          }
      await prisma.sessionTurn.upsert({
        where: { sessionId_turnIndex: { sessionId, turnIndex: t.turnIndex } },
        create: { sessionId, turnIndex: t.turnIndex, ...data },
        update: data,
      })
      saved += 1
    }

    res.status(201).json({ success: true, count: saved })
  } catch (error) {
    console.error('Error saving session turns:', error)
    res.status(500).json({ error: 'Failed to save session turns' })
  }
}
