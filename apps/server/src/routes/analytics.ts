/**
 * SpashtAI Analytics Engine API Routes
 *
 * POST /sessions/:sessionId/analyze        - Run full analytics pipeline
 * GET  /sessions/:sessionId/skill-scores   - Get skill scores
 * GET  /sessions/:sessionId/coaching-insights - Get coaching feedback
 * GET  /sessions/:sessionId/communication-signals - Get raw signals
 */

import { Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { calculateSkillScores, type TextSignals } from '../analytics/skillScores'
import { generateCoachingInsights } from '../analytics/insightGenerator'
import { saveSkillScoresToPulse } from '../analytics/progressPulse'

const SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://localhost:4001'
const INTERNAL_AGENT_TOKEN = process.env.INTERNAL_AGENT_TOKEN || 'dev-internal-agent-token'

/**
 * Run the full analytics pipeline for a session:
 * 1. Fetch transcript from DB
 * 2. Call Python signal API to extract signals
 * 3. Calculate skill scores
 * 4. Generate coaching insights via Bedrock
 * 5. Save everything + auto-create Progress Pulse entries
 */
export async function analyzeSession(req: Request, res: Response) {
  const { sessionId } = req.params
  const { autoTrackPulse = false, source = 'elevate' } = req.body || {}

  try {
    // 1. Load session + transcript
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { transcript: true },
    })

    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const transcript = session.transcript
    if (!transcript) {
      return res.status(400).json({ error: 'No transcript available for this session' })
    }

    const conversationData = transcript.conversationData as any
    const messages: { role: string; content: string; timestamp?: string }[] = []

    if (Array.isArray(conversationData?.messages)) {
      for (const m of conversationData.messages) {
        if (m.role && m.content) {
          messages.push({ role: m.role, content: m.content, timestamp: m.timestamp })
        }
      }
    } else if (Array.isArray(conversationData?.conversation)) {
      for (const m of conversationData.conversation) {
        if (m.role && m.content) {
          messages.push({ role: m.role, content: m.content })
        }
      }
    }

    if (messages.length === 0) {
      return res.status(400).json({ error: 'Transcript has no messages' })
    }

    // Calculate duration
    const startedAt = session.startedAt ? new Date(session.startedAt).getTime() : 0
    const endedAt = session.endedAt ? new Date(session.endedAt).getTime() : Date.now()
    const durationSec = startedAt ? (endedAt - startedAt) / 1000 : 0

    // 2. Call Python signal extraction API
    let signals: TextSignals
    try {
      const signalRes = await fetch(`${SIGNAL_API_URL}/extract-signals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-agent-token': INTERNAL_AGENT_TOKEN,
        },
        body: JSON.stringify({
          sessionId,
          messages,
          durationSec,
        }),
      })

      if (!signalRes.ok) {
        const errText = await signalRes.text()
        throw new Error(`Signal API returned ${signalRes.status}: ${errText}`)
      }

      const signalData = await signalRes.json()
      signals = signalData.signals
    } catch (signalErr: any) {
      console.error('Signal extraction failed, using fallback:', signalErr.message)
      // Fallback: build minimal signals from messages directly
      signals = buildFallbackSignals(messages, durationSec)
    }

    // 3. Calculate skill scores
    const { scores, components } = calculateSkillScores(signals, messages.length)

    // 4. Generate coaching insights via Bedrock
    let insights
    try {
      insights = await generateCoachingInsights({
        skillScores: scores,
        signals,
        sessionName: session.sessionName || undefined,
        focusArea: session.focusArea || undefined,
        totalMessages: messages.length,
        durationSec,
      })
    } catch (insightErr: any) {
      console.error('Coaching insight generation failed:', insightErr.message)
      insights = { error: insightErr.message }
    }

    // 5. Persist results (cast to plain JSON for Prisma)
    const skillScoresJson = JSON.parse(JSON.stringify({ scores, components }))
    const signalsJson = JSON.parse(JSON.stringify(signals))
    const insightsJson = JSON.parse(JSON.stringify(insights))

    await prisma.sessionMetrics.upsert({
      where: { sessionId },
      create: {
        sessionId,
        skillScores: skillScoresJson,
        communicationSignals: signalsJson,
        coachingInsights: insightsJson,
      },
      update: {
        skillScores: skillScoresJson,
        communicationSignals: signalsJson,
        coachingInsights: insightsJson,
      },
    })

    // 6. Auto-track Progress Pulse if requested
    let pulseCount = 0
    if (autoTrackPulse && session.userId) {
      try {
        pulseCount = await saveSkillScoresToPulse(
          session.userId,
          sessionId,
          source as 'elevate' | 'replay',
          scores,
          components,
        )
      } catch (pulseErr: any) {
        console.error('Progress Pulse save failed:', pulseErr.message)
      }
    }

    res.json({
      sessionId,
      skillScores: scores,
      components,
      coachingInsights: insights,
      signalsSummary: {
        wpm: signals.speechRate.wpm,
        fillerRate: signals.fillers.rate,
        hedgingCount: signals.hedging.count,
        readability: signals.sentenceComplexity.readability,
        vocabDiversity: signals.vocabDiversity.ratio,
        topicCoherence: signals.topicCoherence.avgSimilarity,
      },
      pulseEntriesCreated: pulseCount,
    })
  } catch (error: any) {
    console.error('Analytics pipeline error:', error)
    res.status(500).json({ error: 'Analytics pipeline failed', details: error.message })
  }
}

/**
 * Get cached skill scores for a session.
 */
export async function getSkillScores(req: Request, res: Response) {
  const { sessionId } = req.params
  try {
    const metrics = await prisma.sessionMetrics.findUnique({
      where: { sessionId },
      select: { skillScores: true },
    })
    if (!metrics?.skillScores) {
      return res.status(404).json({ error: 'No skill scores found' })
    }
    res.json(metrics.skillScores)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
}

/**
 * Get cached coaching insights for a session.
 */
export async function getCoachingInsights(req: Request, res: Response) {
  const { sessionId } = req.params
  try {
    const metrics = await prisma.sessionMetrics.findUnique({
      where: { sessionId },
      select: { coachingInsights: true },
    })
    if (!metrics?.coachingInsights) {
      return res.status(404).json({ error: 'No coaching insights found' })
    }
    res.json(metrics.coachingInsights)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
}

/**
 * Get raw communication signals for a session.
 */
export async function getCommunicationSignals(req: Request, res: Response) {
  const { sessionId } = req.params
  try {
    const metrics = await prisma.sessionMetrics.findUnique({
      where: { sessionId },
      select: { communicationSignals: true },
    })
    if (!metrics?.communicationSignals) {
      return res.status(404).json({ error: 'No communication signals found' })
    }
    res.json(metrics.communicationSignals)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
}

/**
 * Fallback signal extraction when Python API is unavailable.
 * Uses basic JS-based text analysis (less accurate than spaCy).
 */
function buildFallbackSignals(
  messages: { role: string; content: string }[],
  durationSec: number,
): TextSignals {
  const userMessages = messages.filter((m) => m.role === 'user')
  const userText = userMessages.map((m) => m.content).join(' ')
  const words = userText.split(/\s+/).filter(Boolean)
  const totalWords = words.length
  const durationMin = durationSec / 60 || 1

  const fillerRegex = /\b(um|uh|like|you know|basically|actually|literally|so|well|right|i mean|kind of|sort of)\b/gi
  const fillerMatches = userText.match(fillerRegex) || []
  const hedgingRegex = /\b(i think|maybe|probably|perhaps|kind of|sort of|i guess|not sure|might|could be)\b/gi
  const hedgingMatches = userText.match(hedgingRegex) || []

  const sentences = userText.split(/[.!?]+/).filter((s) => s.trim().length > 3)
  const avgSentLen = sentences.length > 0
    ? words.length / sentences.length
    : 0

  const uniqueWords = new Set(words.map((w) => w.toLowerCase()).filter((w) => w.length > 2))

  return {
    speechRate: {
      wpm: Math.round(Math.min(200, totalWords / durationMin)),
      variability: 0.2,
      totalWords,
    },
    fillers: {
      count: fillerMatches.length,
      rate: totalWords > 0 ? fillerMatches.length / totalWords : 0,
      byType: {},
    },
    hedging: {
      count: hedgingMatches.length,
      rate: totalWords > 0 ? hedgingMatches.length / totalWords : 0,
      phrases: [...new Set(hedgingMatches.map((m) => m.toLowerCase()))],
    },
    sentenceComplexity: {
      avgLength: Math.round(avgSentLen * 10) / 10,
      subordinateRatio: 0.25,
      readability: 60,
      fleschKincaid: 8,
      gunningFog: 10,
    },
    vocabDiversity: {
      ratio: totalWords > 0 ? uniqueWords.size / totalWords : 0,
      uniqueWords: uniqueWords.size,
      totalWords,
      sophistication: 5,
    },
    topicCoherence: { avgSimilarity: 0.75, driftCount: 0 },
    questionHandling: { questionsReceived: 0, avgResponseTime: 0, relevanceScores: [] },
    talkListenBalance: {
      userRatio: totalWords / Math.max(1, messages.reduce((s, m) => s + m.content.split(/\s+/).length, 0)),
    },
    interactionSignals: {
      questionsAsked: userMessages.filter((m) => m.content.includes('?')).length,
      participantReferences: 0,
      followUps: 0,
    },
    ideaStructure: { markerCount: 0, markerTypes: {} },
  }
}
