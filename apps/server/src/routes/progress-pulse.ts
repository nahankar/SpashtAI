import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma'

export async function getProgressPulse(req: Request, res: Response) {
  try {
    const userId = req.user!.userId
    const { skill, limit: rawLimit } = req.query
    const take = Math.min(Number(rawLimit) || 50, 200)

    const where: any = { userId }
    if (skill && typeof skill === 'string') {
      where.skill = skill
    }

    const records = await prisma.progressPulse.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take,
    })

    res.json({ progress: records })
  } catch (error) {
    console.error('Error fetching progress pulse:', error)
    res.status(500).json({ error: 'Failed to fetch progress pulse' })
  }
}

export async function getProgressPulseSummary(req: Request, res: Response) {
  try {
    const userId = req.user!.userId

    const latestPerSkill = await prisma.$queryRaw<
      { skill: string; latest_score: number; prev_score: number | null; count: number }[]
    >`
      WITH ranked AS (
        SELECT
          skill,
          score,
          "recordedAt",
          ROW_NUMBER() OVER (
            PARTITION BY skill
            ORDER BY "recordedAt" DESC, id DESC
          ) AS rn,
          COUNT(*) OVER (PARTITION BY skill) AS cnt
        FROM "ProgressPulse"
        WHERE "userId" = ${userId}
      )
      SELECT
        r1.skill,
        r1.score AS latest_score,
        r2.score AS prev_score,
        r1.cnt::int AS count
      FROM ranked r1
      LEFT JOIN ranked r2 ON r1.skill = r2.skill AND r2.rn = 2
      WHERE r1.rn = 1
      ORDER BY r1.skill
    `

    const summary = latestPerSkill.map((row) => ({
      skill: row.skill,
      currentScore: Number(row.latest_score),
      previousScore: row.prev_score != null ? Number(row.prev_score) : null,
      delta: row.prev_score != null ? Number(row.latest_score) - Number(row.prev_score) : null,
      totalSessions: Number(row.count),
    }))

    res.json({ summary })
  } catch (error) {
    console.error('Error fetching progress pulse summary:', error)
    res.status(500).json({ error: 'Failed to fetch progress pulse summary' })
  }
}

export async function recordProgressPulse(req: Request, res: Response) {
  try {
    const userId = req.user!.userId
    const { entries, sessionId, source, recordedAt } = req.body

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries array is required' })
    }

    let replayMeetingDate: Date | null = null
    if (source === 'replay' && sessionId) {
      const replay = await prisma.replaySession.findUnique({
        where: { id: sessionId },
        select: { meetingDate: true },
      })
      if (!replay) {
        return res.status(404).json({ error: 'Replay session not found' })
      }
      replayMeetingDate = replay.meetingDate
      const hasRecordedAt =
        (recordedAt != null && recordedAt !== '') ||
        entries.some((e: any) => e.recordedAt != null && e.recordedAt !== '')
      if (!replay.meetingDate && !hasRecordedAt) {
        return res.status(400).json({
          error:
            'Set a meeting date on this replay session before tracking — Progress Pulse uses it to order trends chronologically.',
        })
      }
    }

    let recordedAtDate: Date | undefined
    if (recordedAt != null && recordedAt !== '') {
      recordedAtDate = new Date(recordedAt)
      if (Number.isNaN(recordedAtDate.getTime())) {
        return res.status(400).json({ error: 'recordedAt must be a valid ISO date' })
      }
    } else if (replayMeetingDate) {
      recordedAtDate = replayMeetingDate
    }

    const records = await prisma.progressPulse.createMany({
      data: entries.map((e: any) => {
        const rowRecorded =
          e.recordedAt != null && e.recordedAt !== ''
            ? new Date(e.recordedAt)
            : recordedAtDate
        const validRowRecorded =
          rowRecorded && !Number.isNaN(rowRecorded.getTime()) ? rowRecorded : undefined
        return {
          userId,
          skill: e.skill,
          score: Number(e.score),
          source: source || e.source || 'replay',
          sessionId: sessionId || e.sessionId || null,
          metadata: e.metadata || null,
          ...(validRowRecorded ? { recordedAt: validRowRecorded } : {}),
        }
      }),
    })

    // Mark the session as tracked
    if (sessionId && source) {
      try {
        if (source === 'replay') {
          await prisma.replaySession.update({
            where: { id: sessionId },
            data: { progressPulseStatus: 'tracked' },
          })
        } else if (source === 'elevate') {
          await prisma.session.update({
            where: { id: sessionId },
            data: { progressPulseStatus: 'tracked' },
          })
        }
      } catch {
        // non-critical
      }
    }

    res.status(201).json({ success: true, count: records.count })
  } catch (error) {
    console.error('Error recording progress pulse:', error)
    res.status(500).json({ error: 'Failed to record progress pulse' })
  }
}

export async function skipProgressPulse(req: Request, res: Response) {
  try {
    const { sessionId, source } = req.body

    if (!sessionId || !source) {
      return res.status(400).json({ error: 'sessionId and source are required' })
    }

    if (source === 'replay') {
      await prisma.replaySession.update({
        where: { id: sessionId },
        data: { progressPulseStatus: 'skipped' },
      })
    } else if (source === 'elevate') {
      await prisma.session.update({
        where: { id: sessionId },
        data: { progressPulseStatus: 'skipped' },
      })
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Error skipping progress pulse:', error)
    res.status(500).json({ error: 'Failed to skip progress pulse' })
  }
}
