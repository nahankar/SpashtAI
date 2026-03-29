import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import type { Prisma } from '@prisma/client'

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

    const skills = latestPerSkill.map((row) => row.skill)

    const historyRows = skills.length > 0
      ? await prisma.progressPulse.findMany({
          where: { userId, skill: { in: skills } },
          orderBy: { recordedAt: 'asc' },
          select: { skill: true, score: true, recordedAt: true },
          take: skills.length * 10,
        })
      : []

    const historyBySkill: Record<string, { score: number; date: string }[]> = {}
    for (const row of historyRows) {
      const arr = historyBySkill[row.skill] || (historyBySkill[row.skill] = [])
      arr.push({ score: Number(row.score), date: row.recordedAt.toISOString().slice(0, 10) })
    }

    const summary = latestPerSkill.map((row) => ({
      skill: row.skill,
      currentScore: Number(row.latest_score),
      previousScore: row.prev_score != null ? Number(row.prev_score) : null,
      delta: row.prev_score != null ? Number(row.latest_score) - Number(row.prev_score) : null,
      totalSessions: Number(row.count),
      history: (historyBySkill[row.skill] || []).slice(-10),
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

/**
 * GET /api/coaching-context?focusArea=conciseness&replaySessionId=xxx
 *
 * Assembles rich context for the Elevate AI coach:
 * - Current skill scores from Progress Pulse (all skills, with history)
 * - Latest Replay session metrics + AI insights for the focused skill
 * - User's specific examples (filler phrases, hedging phrases, etc.)
 * - Previous Elevate practice sessions for the same focus area
 */
export async function getCoachingContext(req: Request, res: Response) {
  try {
    const userId = req.user!.userId
    const focusArea = (req.query.focusArea as string) || ''
    const replaySessionId = req.query.replaySessionId as string | undefined

    // 1. All Progress Pulse scores (latest per skill + trend)
    const allSkills = ['clarity', 'conciseness', 'confidence', 'structure', 'engagement', 'pacing']
    const skillSummaries: Record<string, { current: number; previous: number | null; sessions: number }> = {}

    for (const skill of allSkills) {
      const records = await prisma.progressPulse.findMany({
        where: { userId, skill },
        orderBy: { recordedAt: 'desc' },
        take: 5,
        select: { score: true },
      })
      if (records.length > 0) {
        skillSummaries[skill] = {
          current: records[0].score,
          previous: records.length > 1 ? records[1].score : null,
          sessions: records.length,
        }
      }
    }

    // 2. Latest Replay result for this user (or specific session if provided)
    let replayInsights: any = null
    const replayWhere: Prisma.ReplaySessionWhereInput = replaySessionId
      ? { id: replaySessionId, userId }
      : { userId, status: 'completed' }

    const latestReplay = await prisma.replaySession.findFirst({
      where: replayWhere,
      orderBy: { createdAt: 'desc' },
      include: {
        result: {
          select: {
            overallScore: true,
            wordsPerMinute: true,
            fillerWordCount: true,
            fillerWordRate: true,
            hedgingCount: true,
            hedgingRate: true,
            avgSentenceLength: true,
            vocabularyDiversity: true,
            speakingPercentage: true,
            questionsAsked: true,
            skillScores: true,
            coachingInsights: true,
            improvements: true,
            strengths: true,
            annotatedTranscript: true,
            communicationSignals: true,
          },
        },
      },
    })

    if (latestReplay?.result) {
      const r = latestReplay.result
      const skills = r.skillScores as any
      const coaching = r.coachingInsights as any
      const improvements = r.improvements as any[]
      const strengths = r.strengths as any[]
      const signals = r.communicationSignals as any

      // Extract focus-specific improvement suggestions
      const focusImprovements = improvements?.filter((imp: any) => {
        const text = `${imp.point || ''} ${imp.suggestion || ''}`.toLowerCase()
        return text.includes(focusArea) || matchesFocusKeywords(focusArea, text)
      }) || []

      // Extract real example phrases from the user's meeting
      const examplePhrases = extractExamplePhrases(
        focusArea,
        improvements,
        r.annotatedTranscript as any[],
        signals,
      )

      replayInsights = {
        sessionName: latestReplay.sessionName,
        meetingType: latestReplay.meetingType,
        overallScore: r.overallScore,
        metrics: {
          wordsPerMinute: r.wordsPerMinute,
          fillerWordCount: r.fillerWordCount,
          fillerWordRate: r.fillerWordRate,
          hedgingCount: r.hedgingCount,
          hedgingRate: r.hedgingRate,
          avgSentenceLength: r.avgSentenceLength,
          vocabularyDiversity: r.vocabularyDiversity,
          speakingPercentage: r.speakingPercentage,
          questionsAsked: r.questionsAsked,
        },
        skillScores: skills?.scores || null,
        skillComponents: skills?.components || null,
        focusImprovements,
        strengths: strengths?.slice(0, 3) || [],
        primaryImprovement: coaching?.primaryImprovement || null,
        hedgingPhrases: signals?.hedging?.phrases?.slice(0, 5) || coaching?.topHedgingPhrases || null,
        fillersByType: signals?.fillers?.byType || null,
        examplePhrases,
        replayTrigger: coaching?.primaryImprovement || focusImprovements?.[0]?.point || null,
      }
    }

    // 3. Previous Elevate sessions for this focus area (for continuity)
    const previousElevateSessions = await prisma.session.findMany({
      where: {
        userId,
        module: 'elevate',
        focusArea: focusArea || undefined,
        endedAt: { not: null },
      },
      orderBy: { startedAt: 'desc' },
      take: 3,
      select: {
        id: true,
        sessionName: true,
        focusArea: true,
        startedAt: true,
        durationSec: true,
        metrics: {
          select: {
            userWpm: true,
            userFillerCount: true,
            userFillerRate: true,
          },
        },
      },
    })

    res.json({
      focusArea,
      skillSummaries,
      replayInsights,
      previousElevateSessions: previousElevateSessions.map((s) => ({
        sessionName: s.sessionName,
        focusArea: s.focusArea,
        date: s.startedAt,
        durationSec: s.durationSec,
        metrics: s.metrics,
      })),
    })
  } catch (error) {
    console.error('Error fetching coaching context:', error)
    res.status(500).json({ error: 'Failed to fetch coaching context' })
  }
}

/**
 * Extract real example phrases from the user's meeting that relate to the focus area.
 * These become powerful coaching anchors — the AI can reference what they actually said.
 */
function extractExamplePhrases(
  focusArea: string,
  improvements: any[] | null,
  annotatedTranscript: any[] | null,
  signals: any | null,
): string[] {
  const examples: string[] = []

  // From improvement examples (AI already identified these)
  if (improvements) {
    for (const imp of improvements) {
      if (imp.example && typeof imp.example === 'string' && imp.example.length > 10) {
        const text = `${imp.point || ''} ${imp.suggestion || ''}`.toLowerCase()
        if (matchesFocusKeywords(focusArea, text) || examples.length < 2) {
          examples.push(imp.example)
        }
      }
    }
  }

  // From annotated transcript segments with relevant annotations
  if (annotatedTranscript && examples.length < 3) {
    const relevantAnnotations: Record<string, string[]> = {
      conciseness: ['filler_word', 'hedging'],
      confidence: ['hedging'],
      filler_words: ['filler_word'],
      clarity: ['clarification'],
      engagement: ['clarification', 'strong_statement'],
      structure: ['key_point', 'strong_statement'],
      pacing: [],
      action_items: ['action_item', 'decision', 'suggestion'],
    }
    const targetAnnotations = relevantAnnotations[focusArea] || []

    for (const seg of annotatedTranscript) {
      if (examples.length >= 4) break
      const annots: string[] = seg.annotations || []
      if (targetAnnotations.some((t) => annots.includes(t))) {
        const text = seg.text?.trim()
        if (text && text.length > 15 && text.length < 200) {
          examples.push(text)
        }
      }
    }
  }

  return examples.slice(0, 4)
}

function matchesFocusKeywords(focusArea: string, text: string): boolean {
  const keywordMap: Record<string, string[]> = {
    clarity: ['clear', 'clarity', 'jargon', 'articulate', 'understandable'],
    conciseness: ['concise', 'brief', 'wordy', 'verbose', 'rambling', 'filler'],
    confidence: ['confident', 'hedging', 'assertive', 'decisive', 'hesitant'],
    structure: ['structure', 'organize', 'framework', 'logical', 'flow'],
    engagement: ['engage', 'question', 'interactive', 'attention', 'involve'],
    pacing: ['pace', 'speed', 'slow', 'fast', 'wpm', 'rushing'],
    filler_words: ['filler', 'um', 'uh', 'like', 'basically', 'actually'],
    action_items: ['action', 'decision', 'closing', 'next steps', 'follow up'],
  }
  const keywords = keywordMap[focusArea] || []
  return keywords.some((kw) => text.includes(kw))
}
