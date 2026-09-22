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
import { logger, reqLog } from '../lib/logger'
import {
  calculateSkillScores,
  calculateWeightedOverallScore,
  type SkillScores,
  type TextSignals,
} from '../analytics/skillScores'
import {
  generateCoachingInsights,
  resolveElevateSessionAudio,
} from '../analytics/insightGenerator'
import { saveSkillScoresToPulse } from '../analytics/progressPulse'
import { generateTurnSuggestions } from '../analytics/turnSuggestions'
import { getElevateSessionOwnerId, resolveRequestExportFlags } from '../lib/userExportFlags'
import { enrichElevateSessionAudio, fetchProsodyForPath } from '../analytics/audioEnrichment'
import {
  hasRealProsody,
  mergeCommunicationSignals,
  mergeProcessingStatus,
  resolveAudioStatus,
  shouldWritePulse,
} from '../analytics/audioStatus'
import { lockWritableSession, SessionDiscardedError } from '../lib/sessionDiscard'
import {
  assessPaceEvidence,
  measuredTurnVariability,
  readPersistedPaceEvidence,
  selectBestPaceEvidence,
} from '../analytics/pace'

const SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://localhost:4001'
const INTERNAL_AGENT_TOKEN =
  process.env.INTERNAL_AGENT_TOKEN?.trim() ||
  (process.env.NODE_ENV !== 'production' ? 'dev-internal-agent-token' : '')
const MIN_ANALYTICS_USER_WORDS = 5

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
  const { autoTrackPulse = false, source = 'elevate', audioCapture = null } = req.body || {}

  try {
    // 1. Load session + transcript
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        transcript: true,
        segments: true,
        turns: { select: { role: true, metrics: true } },
      },
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
    // Endpointing often emits one-to-three-word debris around interruptions
    // ("and", "things", "you be great"). Keep it in the transcript, but do
    // not let it affect aggregate language signals or skill scores.
    const analysisMessages = messages.filter((message) => {
      if (message.role !== 'user') return message.content.trim().split(/\s+/).length >= 2
      return message.content.trim().split(/\s+/).length >= MIN_ANALYTICS_USER_WORDS
    })

    // Calculate duration
    const startedAt = session.startedAt ? new Date(session.startedAt).getTime() : 0
    const endedAt = session.endedAt ? new Date(session.endedAt).getTime() : Date.now()
    const durationSec =
      session.durationSec ??
      (startedAt ? (endedAt - startedAt) / 1000 : 0)

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
          messages: analysisMessages,
          durationSec,
        }),
        // Never let a slow/contended signal service stall the whole pipeline —
        // fall back to JS signal extraction instead.
        signal: AbortSignal.timeout(20000),
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
      signals = buildFallbackSignals(analysisMessages, durationSec)
    }

    const existingMetrics = await prisma.sessionMetrics.findUnique({
      where: { sessionId },
      select: {
        communicationSignals: true,
        coachingInsights: true,
        processingStatus: true,
        skillScores: true,
      },
    })

    // 4. Acoustic prosody only from a readable recording. A short wait covers
    // an in-flight browser upload; timeout stays pending, never unavailable.
    let audioResolved = await resolveElevateSessionAudio(sessionId)
    if (!audioResolved) {
      for (let i = 0; i < 3 && !audioResolved; i += 1) {
        await new Promise((r) => setTimeout(r, 1000))
        audioResolved = await resolveElevateSessionAudio(sessionId)
      }
    }

    if (audioResolved?.audioPath) {
      try {
        const prosody = await fetchProsodyForPath(sessionId, audioResolved.audioPath)
        if (hasRealProsody({ prosody })) {
          ;(signals as { prosody?: unknown }).prosody = prosody
        }
      } catch (prosodyErr: unknown) {
        const message = prosodyErr instanceof Error ? prosodyErr.message : String(prosodyErr)
        console.warn('[analytics] prosody analysis skipped:', message)
      }
    }

    // The old aggregate silence detector merged every sub-3-second pause into
    // one giant "speech" span. Accept only persisted, source-labelled timing
    // evidence from STT timestamps or measured utterances.
    const pace = selectBestPaceEvidence(
      readPersistedPaceEvidence(existingMetrics?.processingStatus),
      session.turns,
      signals.speechRate.totalWords,
    )
    signals.speechRate = {
      ...signals.speechRate,
      wpm: pace.wpm ?? 0,
      variability:
        pace.status === 'available'
          ? measuredTurnVariability(session.turns)
          : null,
      status: pace.status,
      source: pace.source,
      confidence: pace.confidence,
      evidence: {
        origin: pace.origin,
        sourceComposition: pace.sourceComposition,
        totalWords: pace.totalWords,
        speakingSeconds: pace.speakingSeconds,
        samples: pace.samples,
        estimatedSamples: pace.estimatedSamples,
        coverage: pace.coverage,
        excludedMicroTurnCount: pace.excludedMicroTurnCount,
        excludedShortDurationCount: pace.excludedShortDurationCount,
        excludedUnreliableTurnCount: pace.excludedUnreliableTurnCount,
        timestampCoverage: pace.timestampCoverage,
        invalidTimestampCount: pace.invalidTimestampCount,
        outOfOrderTimestampCount: pace.outOfOrderTimestampCount,
      },
    }

    const mergedSignals = mergeCommunicationSignals(
      existingMetrics?.communicationSignals,
      signals as unknown as Record<string, unknown>,
    )
    // Scores must be calculated after real prosody and aggregate speaking time
    // are present; calculating earlier silently made delivery text-only.
    const { scores, components } = calculateSkillScores(
      mergedSignals as unknown as TextSignals,
      analysisMessages.length,
    )
    const audioStatus = resolveAudioStatus({
      hasReadableRecording: Boolean(audioResolved?.audioPath),
      capture: typeof audioCapture === 'string' ? audioCapture : null,
    })
    const audioProcessed = hasRealProsody(mergedSignals)

    let insights
    try {
      insights = await generateCoachingInsights({
        skillScores: scores,
        signals: mergedSignals as unknown as TextSignals,
        sessionName: session.sessionName || undefined,
        focusArea: session.focusArea || undefined,
        totalMessages: analysisMessages.length,
        durationSec,
        audioPath: audioResolved?.audioPath,
        audioMime: audioResolved?.audioMime,
      })
    } catch (insightErr: any) {
      console.error('Coaching insight generation failed:', insightErr.message)
      insights = existingMetrics?.coachingInsights ?? { error: insightErr.message }
    }

    const skillScoresJson = JSON.parse(JSON.stringify({ scores, components }))
    const signalsJson = JSON.parse(JSON.stringify(mergedSignals))
    const insightsJson = JSON.parse(JSON.stringify(insights))
    await prisma.$transaction(async (tx) => {
      await lockWritableSession(tx, sessionId)
      const latestMetrics = await tx.sessionMetrics.findUnique({
        where: { sessionId },
        select: { processingStatus: true },
      })
      const finalPace = selectBestPaceEvidence(
        readPersistedPaceEvidence(latestMetrics?.processingStatus),
        session.turns,
        signals.speechRate.totalWords,
      )
      const processingStatusJson = JSON.parse(
        JSON.stringify({
          ...mergeProcessingStatus(latestMetrics?.processingStatus, {
            audioStatus,
            audioProcessed,
          }),
          pace: finalPace,
        }),
      )
      await tx.sessionMetrics.upsert({
        where: { sessionId },
        create: {
          sessionId,
          userWpm: finalPace.wpm ?? 0,
          userFillerCount: signals.fillers.count,
          userFillerRate: signals.fillers.rate * 100,
          userAvgSentenceLength: signals.sentenceComplexity.avgLength,
          userSpeakingTime:
            finalPace.status === 'available' ? finalPace.speakingSeconds : 0,
          userVocabDiversity: signals.vocabDiversity.ratio,
          totalTurns: messages.length,
          skillScores: skillScoresJson,
          communicationSignals: signalsJson,
          coachingInsights: insightsJson,
          processingStatus: processingStatusJson,
        },
        update: {
          userWpm: finalPace.wpm ?? 0,
          userFillerCount: signals.fillers.count,
          userFillerRate: signals.fillers.rate * 100,
          userAvgSentenceLength: signals.sentenceComplexity.avgLength,
          userSpeakingTime:
            finalPace.status === 'available' ? finalPace.speakingSeconds : 0,
          userVocabDiversity: signals.vocabDiversity.ratio,
          totalTurns: messages.length,
          skillScores: skillScoresJson,
          communicationSignals: signalsJson,
          coachingInsights: insightsJson,
          processingStatus: processingStatusJson,
        },
      })
    })

    let pulseCount = 0
    const existingPulseRows = sessionId
      ? await prisma.progressPulse.count({ where: { sessionId } })
      : 0
    if (
      session.userId &&
      shouldWritePulse({
        autoTrackPulse: Boolean(autoTrackPulse),
        progressPulseStatus: session.progressPulseStatus,
        existingPulseRows,
      })
    ) {
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
    // Acoustics are best-effort inline. Retry out of band so one failed prosody
    // call does not leave delivery metrics permanently empty for a session
    // whose recording is readable.
    if (audioResolved?.audioPath && !audioProcessed) {
      void enrichElevateSessionAudio(sessionId)
    }
    reqLog(req).info(
      { event: 'analyze.succeeded', sessionId, source, pulseEntriesCreated: pulseCount },
      'session analyzed',
    )
  } catch (error: any) {
    if (error instanceof SessionDiscardedError) {
      return res.status(410).json({ error: error.message })
    }
    reqLog(req).error({ err: error, event: 'analyze.failed', sessionId, source }, 'analytics pipeline error')
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
      select: { skillScores: true, processingStatus: true },
    })
    if (!metrics?.skillScores) {
      return res.status(404).json({ error: 'No skill scores found' })
    }
    const payload = JSON.parse(JSON.stringify(metrics.skillScores)) as {
      scores?: Record<string, unknown>
      components?: Record<string, unknown>
    }
    const persistedPace = readPersistedPaceEvidence(metrics.processingStatus)
    const expectedWords =
      persistedPace && typeof persistedPace === 'object'
        ? Number((persistedPace as Record<string, unknown>).totalWords) || 0
        : 0
    const pace = assessPaceEvidence(persistedPace, expectedWords)
    if (pace.status !== 'available') {
      if (payload.scores) payload.scores.pacing = null
      if (payload.components) delete payload.components.pacing
    }
    const overallScore = payload.scores
      ? calculateWeightedOverallScore(payload.scores as unknown as SkillScores)
      : null
    res.json({ ...payload, overallScore })
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
 * Get a few AI-generated phrasing suggestions for the user's most improvable
 * turns (powers the "AI suggestion" tooltips in Playback). Best-effort: always
 * returns 200 with a (possibly empty) list so the UI degrades gracefully.
 */
export async function getTurnSuggestions(req: Request, res: Response) {
  const { sessionId } = req.params
  try {
    const ownerId = await getElevateSessionOwnerId(sessionId)
    const { accessDenied } = await resolveRequestExportFlags(req, ownerId)
    if (accessDenied) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const turns = await prisma.sessionTurn.findMany({
      where: { sessionId },
      orderBy: { turnIndex: 'asc' },
      select: { turnIndex: true, role: true, text: true, metrics: true },
    })

    const suggestions = await generateTurnSuggestions(sessionId, turns as any)
    res.json({ suggestions })
  } catch (error: any) {
    console.warn('[turn-suggestions] handler error:', error?.message || error)
    res.json({ suggestions: [] })
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
