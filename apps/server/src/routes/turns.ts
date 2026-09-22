import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import {
  exportDenied,
  getElevateSessionOwnerId,
  resolveRequestExportFlags,
} from '../lib/userExportFlags'
import { dedupeConversationMessages } from '../lib/dedupeMessages'
import {
  alignTurnsToAudio,
  buildSkipIntervalsFromTurnWords,
  buildSkipPlaybackRegions,
  detectSpeechRegions,
} from '../lib/audioAlignment'
import {
  resolveElevateSessionAudio,
  resolveSessionSegmentAudio,
} from '../analytics/insightProviders/resolveSessionAudio'
import { compareSegmentTurns } from '../analytics/sessionSegments'
import {
  lockWritableSession,
  SessionDiscardedError,
  SessionMissingError,
} from '../lib/sessionDiscard'

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
      orderBy: { sequenceNo: 'asc' },
    })
    const segments = await prisma.sessionSegment.findMany({
      where: { sessionId },
      orderBy: { segmentIndex: 'asc' },
      include: { recording: { select: { duration: true } } },
    })
    const resolvedAudio = await resolveElevateSessionAudio(sessionId).catch(() => null)
    // This is the one canonical segment list for both the merged stream and
    // replay offsets. Unreadable files are absent, so later words cannot drift.
    const segmentOffsets = new Map(
      (resolvedAudio?.segments ?? []).map((segment) => [
        segment.segmentId,
        segment.replayOffsetSec,
      ]),
    )
    turns = turns.map((turn) => {
      if (!turn.segmentId) return turn
      if (!segmentOffsets.has(turn.segmentId)) {
        return { ...turn, audioStart: null, audioEnd: null, words: null }
      }
      const offset = segmentOffsets.get(turn.segmentId) ?? 0
      return {
        ...turn,
        audioStart: turn.audioStart == null ? null : turn.audioStart + offset,
        audioEnd: turn.audioEnd == null ? null : turn.audioEnd + offset,
        words: Array.isArray(turn.words)
          ? turn.words.map((word: any) => ({
              ...word,
              start: typeof word.start === 'number' ? word.start + offset : word.start,
              end: typeof word.end === 'number' ? word.end + offset : word.end,
            }))
          : turn.words,
      }
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

    // Prefer per-word STT clusters (matches what the user actually said per turn);
    // fall back to ffmpeg speech blips when words are unavailable.
    const wordSkipRegions = buildSkipIntervalsFromTurnWords(sanitized)
    let speechRegions: { start: number; end: number }[] = []
    let skipPlaybackRegions: { start: number; end: number }[] = wordSkipRegions
    try {
      if (resolvedAudio?.audioPath) {
        speechRegions = await detectSpeechRegions(resolvedAudio.audioPath)
        if (skipPlaybackRegions.length === 0) {
          const userTurnCount = turns.filter((t) => t.role === 'user').length
          const firstUserStart = turns.find(
            (t) => t.role === 'user' && t.audioStart != null,
          )?.audioStart as number | undefined
          skipPlaybackRegions = buildSkipPlaybackRegions(
            speechRegions,
            userTurnCount,
            firstUserStart != null ? { minTurnStart: firstUserStart - 1.5 } : {},
          )
        }
      }
    } catch {
      /* optional — playback still works without skip-gap hints */
    }

    res.json({
      sessionId,
      recordingStartedAt: session?.recordingStartedAt ?? null,
      transcriptHidden: flags.hideTranscriptText,
      degraded,
      segments: segments.map((segment) => ({
        id: segment.id,
        segmentIndex: segment.segmentIndex,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        activeDurationSec: segment.activeDurationSec,
        audioStatus: segment.audioStatus,
        replayOffsetSec: segmentOffsets.get(segment.id) ?? null,
        recordingDurationSec:
          segment.recordingDurationSec ?? segment.recording?.duration ?? null,
      })),
      speechRegions,
      skipPlaybackRegions,
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
    const segmentId =
      typeof req.body?.segmentId === 'string' && req.body.segmentId.trim()
        ? req.body.segmentId.trim()
        : null
    const turns = (req.body?.turns ?? []) as IncomingTurn[]
    if (!Array.isArray(turns) || turns.length === 0) {
      return res.status(400).json({ error: 'turns[] is required' })
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }
    const segment = segmentId
      ? await prisma.sessionSegment.findUnique({ where: { id: segmentId } })
      : null
    if (segmentId && (!segment || segment.sessionId !== sessionId)) {
      return res.status(404).json({ error: 'Session segment not found' })
    }

    // Primary alignment: derive per-turn timings straight from the recording.
    // The user's mic track is the ground truth — ffmpeg silencedetect finds the
    // exact speech regions, which we snap each user turn onto. This is immune to
    // the STT word-clock's blind spots (it strips greeting lead-in and the
    // coach's speaking gaps, so a single shift can't align later turns).
    let alignmentInfo = 'audio: none'
    let alignedById: Map<number, IncomingTurn> | null = null
    try {
      const resolved = segmentId
        ? await resolveSessionSegmentAudio(segmentId)
        : await resolveElevateSessionAudio(sessionId)
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
    const recordingStartedAt = segment?.recordingStartedAt ?? session.recordingStartedAt
    if (Number.isFinite(sttEpochMs) && recordingStartedAt) {
      shiftSec = sttEpochMs / 1000 - recordingStartedAt.getTime() / 1000
      if (!Number.isFinite(shiftSec)) shiftSec = 0
    }
    console.log(
      `[turns] ${sessionId} align (${alignmentInfo}); fallback shift=${shiftSec.toFixed(
        2,
      )}s (sttEpochMs=${Number.isFinite(sttEpochMs) ? sttEpochMs : 'none'} recordingStartedAt=${
        recordingStartedAt?.toISOString() ?? 'none'
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

    const validTurns = turns.filter(
      (t) => typeof t.turnIndex === 'number' && t.role && typeof t.text === 'string',
    )
    let saved = 0
    await prisma.$transaction(async (tx) => {
      await lockWritableSession(tx, sessionId)
      // Serialize sequence allocation for all segments in one session.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`
      const latest = await tx.sessionTurn.findFirst({
        where: { sessionId },
        orderBy: { sequenceNo: 'desc' },
        select: { sequenceNo: true },
      })
      let nextSequence = (latest?.sequenceNo ?? -1) + 1

      for (const t of validTurns) {
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

        if (segmentId) {
          const existing = await tx.sessionTurn.findUnique({
            where: {
              segmentId_localTurnIndex: {
                segmentId,
                localTurnIndex: t.turnIndex,
              },
            },
          })
          if (existing) {
            await tx.sessionTurn.update({ where: { id: existing.id }, data })
          } else {
            const sequenceNo = nextSequence++
            await tx.sessionTurn.create({
              data: {
                sessionId,
                segmentId,
                localTurnIndex: t.turnIndex,
                sequenceNo,
                turnIndex: sequenceNo,
                ...data,
              },
            })
          }
        } else {
          // Legacy agents use the old session-local index.
          await tx.sessionTurn.upsert({
            where: { sessionId_turnIndex: { sessionId, turnIndex: t.turnIndex } },
            create: {
              sessionId,
              localTurnIndex: t.turnIndex,
              sequenceNo: t.turnIndex,
              turnIndex: t.turnIndex,
              ...data,
            },
            update: data,
          })
        }
        saved += 1
      }

      if (segmentId) {
        // Arrival order is not reliable: a closing segment can finish persisting
        // after its successor has already started. Re-number from persisted
        // segment order so replay remains globally monotonic and contiguous.
        const allTurns = await tx.sessionTurn.findMany({
          where: { sessionId },
          include: { segment: { select: { segmentIndex: true } } },
        })
        allTurns.sort((a, b) =>
          compareSegmentTurns(
            {
              segmentIndex: a.segment?.segmentIndex ?? null,
              localTurnIndex: a.localTurnIndex,
            },
            {
              segmentIndex: b.segment?.segmentIndex ?? null,
              localTurnIndex: b.localTurnIndex,
            },
          ),
        )
        const temporaryBase = 1_000_000_000
        for (let index = 0; index < allTurns.length; index += 1) {
          await tx.sessionTurn.update({
            where: { id: allTurns[index].id },
            data: {
              sequenceNo: temporaryBase + index,
              turnIndex: temporaryBase + index,
            },
          })
        }
        for (let index = 0; index < allTurns.length; index += 1) {
          await tx.sessionTurn.update({
            where: { id: allTurns[index].id },
            data: { sequenceNo: index, turnIndex: index },
          })
        }
      }
    })

    res.status(201).json({ success: true, count: saved })
  } catch (error) {
    if (error instanceof SessionDiscardedError || error instanceof SessionMissingError) {
      return res.status(error.status).json({ error: error.message })
    }
    console.error('Error saving session turns:', error)
    res.status(500).json({ error: 'Failed to save session turns' })
  }
}
