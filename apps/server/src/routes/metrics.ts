import { Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export async function saveSessionMetrics(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const metricsData = req.body

    // Validate session exists
    const session = await prisma.session.findUnique({
      where: { id: sessionId }
    })

    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    // Save or update metrics
    const metrics = await prisma.sessionMetrics.upsert({
      where: { sessionId },
      update: {
        // LiveKit metrics
        totalLlmTokens: metricsData.totalLlmTokens || 0,
        totalLlmDuration: metricsData.totalLlmDuration || 0,
        avgTtft: metricsData.avgTtft || 0,
        totalTtsDuration: metricsData.totalTtsDuration || 0,
        totalTtsAudioDuration: metricsData.totalTtsAudioDuration || 0,
        avgTtsTtfb: metricsData.avgTtsTtfb || 0,
        totalEouDelay: metricsData.totalEouDelay || 0,
        conversationLatencyAvg: metricsData.conversationLatencyAvg || 0,
        
        // User metrics
        userWpm: metricsData.userMetrics?.words_per_minute || 0,
        userFillerCount: metricsData.userMetrics?.filler_word_count || 0,
        userFillerRate: metricsData.userMetrics?.filler_word_rate || 0,
        userAvgSentenceLength: metricsData.userMetrics?.average_sentence_length || 0,
        userSpeakingTime: metricsData.userMetrics?.total_speaking_time || 0,
        userVocabDiversity: metricsData.userMetrics?.vocabulary_diversity || 0,
        userResponseTimeAvg: metricsData.userMetrics?.response_time_avg || 0,
        
        // Assistant metrics
        assistantWpm: metricsData.assistantMetrics?.words_per_minute || 0,
        assistantFillerCount: metricsData.assistantMetrics?.filler_word_count || 0,
        assistantFillerRate: metricsData.assistantMetrics?.filler_word_rate || 0,
        assistantAvgSentenceLength: metricsData.assistantMetrics?.average_sentence_length || 0,
        assistantSpeakingTime: metricsData.assistantMetrics?.total_speaking_time || 0,
        assistantVocabDiversity: metricsData.assistantMetrics?.vocabulary_diversity || 0,
        assistantResponseTimeAvg: metricsData.assistantMetrics?.response_time_avg || 0,
        
        totalTurns: metricsData.totalTurns || 0,
      },
      create: {
        sessionId,
        // LiveKit metrics
        totalLlmTokens: metricsData.totalLlmTokens || 0,
        totalLlmDuration: metricsData.totalLlmDuration || 0,
        avgTtft: metricsData.avgTtft || 0,
        totalTtsDuration: metricsData.totalTtsDuration || 0,
        totalTtsAudioDuration: metricsData.totalTtsAudioDuration || 0,
        avgTtsTtfb: metricsData.avgTtsTtfb || 0,
        totalEouDelay: metricsData.totalEouDelay || 0,
        conversationLatencyAvg: metricsData.conversationLatencyAvg || 0,
        
        // User metrics
        userWpm: metricsData.userMetrics?.words_per_minute || 0,
        userFillerCount: metricsData.userMetrics?.filler_word_count || 0,
        userFillerRate: metricsData.userMetrics?.filler_word_rate || 0,
        userAvgSentenceLength: metricsData.userMetrics?.average_sentence_length || 0,
        userSpeakingTime: metricsData.userMetrics?.total_speaking_time || 0,
        userVocabDiversity: metricsData.userMetrics?.vocabulary_diversity || 0,
        userResponseTimeAvg: metricsData.userMetrics?.response_time_avg || 0,
        
        // Assistant metrics
        assistantWpm: metricsData.assistantMetrics?.words_per_minute || 0,
        assistantFillerCount: metricsData.assistantMetrics?.filler_word_count || 0,
        assistantFillerRate: metricsData.assistantMetrics?.filler_word_rate || 0,
        assistantAvgSentenceLength: metricsData.assistantMetrics?.average_sentence_length || 0,
        assistantSpeakingTime: metricsData.assistantMetrics?.total_speaking_time || 0,
        assistantVocabDiversity: metricsData.assistantMetrics?.vocabulary_diversity || 0,
        assistantResponseTimeAvg: metricsData.assistantMetrics?.response_time_avg || 0,
        
        totalTurns: metricsData.totalTurns || 0,
      }
    })

    res.json({ success: true, metrics })
  } catch (error) {
    console.error('Error saving session metrics:', error)
    res.status(500).json({ error: 'Failed to save metrics' })
  }
}

export async function saveSessionTranscript(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const transcriptData = req.body

    // Validate session exists
    const session = await prisma.session.findUnique({
      where: { id: sessionId }
    })

    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    // Save or update transcript
    const transcript = await prisma.sessionTranscript.upsert({
      where: { sessionId },
      update: {
        conversationData: transcriptData
      },
      create: {
        sessionId,
        conversationData: transcriptData
      }
    })

    res.json({ success: true, transcript })
  } catch (error) {
    console.error('Error saving session transcript:', error)
    res.status(500).json({ error: 'Failed to save transcript' })
  }
}

export async function getSessionMetrics(req: Request, res: Response) {
  try {
    const { sessionId } = req.params

    // First check if session exists
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        module: true,
        startedAt: true,
        endedAt: true,
        user: {
          select: {
            id: true,
            email: true
          }
        }
      }
    })

    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    // Get metrics if they exist
    const metrics = await prisma.sessionMetrics.findUnique({
      where: { sessionId },
      include: {
        session: {
          select: {
            id: true,
            module: true,
            startedAt: true,
            endedAt: true,
            user: {
              select: {
                id: true,
                email: true
              }
            }
          }
        }
      }
    })

    // If no metrics exist yet, return defaults
    if (!metrics) {
      const defaultMetrics = {
        id: null,
        sessionId,
        totalLlmTokens: 0,
        totalLlmDuration: 0,
        avgTtft: 0,
        totalTtsDuration: 0,
        totalTtsAudioDuration: 0,
        avgTtsTtfb: 0,
        totalEouDelay: 0,
        conversationLatencyAvg: 0,
        userWpm: 0,
        userFillerCount: 0,
        userFillerRate: 0,
        userAvgSentenceLength: 0,
        userSpeakingTime: 0,
        userVocabDiversity: 0,
        userResponseTimeAvg: 0,
        assistantWpm: 0,
        assistantFillerCount: 0,
        assistantFillerRate: 0,
        assistantAvgSentenceLength: 0,
        assistantSpeakingTime: 0,
        assistantVocabDiversity: 0,
        assistantResponseTimeAvg: 0,
        totalTurns: 0,
        createdAt: new Date().toISOString(),
        session
      }
      return res.json(defaultMetrics)
    }

    res.json(metrics)
  } catch (error) {
    console.error('Error fetching session metrics:', error)
    res.status(500).json({ error: 'Failed to fetch metrics' })
  }
}

export async function getSessionTranscript(req: Request, res: Response) {
  try {
    const { sessionId } = req.params

    const transcript = await prisma.sessionTranscript.findUnique({
      where: { sessionId },
      include: {
        session: {
          select: {
            id: true,
            module: true,
            startedAt: true,
            endedAt: true,
            user: {
              select: {
                id: true,
                email: true
              }
            }
          }
        }
      }
    })

    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' })
    }

    res.json(transcript)
  } catch (error) {
    console.error('Error fetching session transcript:', error)
    res.status(500).json({ error: 'Failed to fetch transcript' })
  }
}

export async function downloadSessionTranscript(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const { format = 'json' } = req.query

    const transcript = await prisma.sessionTranscript.findUnique({
      where: { sessionId },
      include: {
        session: {
          select: {
            id: true,
            module: true,
            startedAt: true,
            endedAt: true,
            user: {
              select: {
                email: true
              }
            }
          }
        }
      }
    })

    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' })
    }

    const conversationData = transcript.conversationData as any

    // Normalize transcript message shapes across old and new storage formats.
    const messagesFromCurrent = Array.isArray(conversationData?.messages)
      ? conversationData.messages
      : []

    const messagesFromLegacyConversation = Array.isArray(conversationData?.conversation)
      ? conversationData.conversation.map((turn: any, index: number) => ({
          id: turn.id || `legacy_conversation_${index}`,
          role: turn.speaker === 'user' ? 'user' : 'assistant',
          content: turn.text || turn.content || '',
          timestamp: turn.timestamp || new Date().toISOString()
        }))
      : []

    const messagesFromLegacyTurns = Array.isArray(conversationData?.turns)
      ? conversationData.turns.map((turn: any, index: number) => ({
          id: turn.id || `legacy_turn_${index}`,
          role: turn.role === 'user' ? 'user' : 'assistant',
          content: turn.text || turn.content || '',
          timestamp: turn.timestamp || new Date().toISOString()
        }))
      : []

    const normalizedMessages =
      messagesFromCurrent.length > 0
        ? messagesFromCurrent
        : messagesFromLegacyConversation.length > 0
          ? messagesFromLegacyConversation
          : messagesFromLegacyTurns

    if (format === 'txt') {
      // Generate plain text transcript
      let textContent = `Session Transcript\n`
      textContent += `Session ID: ${transcript.sessionId}\n`
      textContent += `User: ${transcript.session.user.email}\n`
      textContent += `Module: ${transcript.session.module}\n`
      textContent += `Date: ${transcript.session.startedAt.toISOString()}\n`
      textContent += `\n${'='.repeat(50)}\n\n`

      if (normalizedMessages.length > 0) {
        for (const message of normalizedMessages) {
          const speaker = message.role === 'user' ? 'User' : 'Assistant'
          const timestamp = message.timestamp
            ? new Date(message.timestamp).toLocaleTimeString()
            : new Date().toLocaleTimeString()
          textContent += `[${timestamp}] ${speaker}: ${message.content || ''}\n\n`
        }
      } else {
        textContent += `No conversation messages found for this session.\n`
      }

      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Disposition', `attachment; filename="transcript-${sessionId}.txt"`)
      res.send(textContent)
    } else {
      // Return JSON format
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="transcript-${sessionId}.json"`)
      res.json({
        session: transcript.session,
        transcript: conversationData,
        messages: normalizedMessages,
        exported_at: new Date().toISOString()
      })
    }
  } catch (error) {
    console.error('Error downloading session transcript:', error)
    res.status(500).json({ error: 'Failed to download transcript' })
  }
}

export async function getUserSessionsMetrics(req: Request, res: Response) {
  try {
    const { userId } = req.params
    const { limit = 10, offset = 0 } = req.query

    const sessions = await prisma.session.findMany({
      where: { userId },
      include: {
        metrics: true,
        transcript: {
          select: {
            id: true,
            createdAt: true
          }
        }
      },
      orderBy: { startedAt: 'desc' },
      take: Number(limit),
      skip: Number(offset)
    })

    // Calculate summary statistics
    const totalSessions = await prisma.session.count({ where: { userId } })
    const avgMetrics = await prisma.sessionMetrics.aggregate({
      where: {
        session: { userId }
      },
      _avg: {
        userWpm: true,
        userFillerRate: true,
        conversationLatencyAvg: true,
        totalTurns: true
      }
    })

    res.json({
      sessions,
      summary: {
        totalSessions,
        averageWpm: avgMetrics._avg.userWpm || 0,
        averageFillerRate: avgMetrics._avg.userFillerRate || 0,
        averageLatency: avgMetrics._avg.conversationLatencyAvg || 0,
        averageTurns: avgMetrics._avg.totalTurns || 0
      }
    })
  } catch (error) {
    console.error('Error fetching user session metrics:', error)
    res.status(500).json({ error: 'Failed to fetch user metrics' })
  }
}

/**
 * Calculate basic metrics from conversation text (no audio required)
 * POST /sessions/:sessionId/calculate-text-metrics
 */
export async function calculateTextMetrics(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    
    // Get conversation data
    const transcript = await prisma.sessionTranscript.findUnique({
      where: { sessionId },
      include: { session: true }
    })

    if (!transcript) {
      return res.json({
        sessionId,
        metrics: null,
        message: 'No conversation data yet — session may still be in progress'
      })
    }

    const conversationData = transcript.conversationData as any
    const messagesFromCurrent = Array.isArray(conversationData?.messages)
      ? conversationData.messages
      : []
    const messagesFromLegacyConversation = Array.isArray(conversationData?.conversation)
      ? conversationData.conversation.map((turn: any, index: number) => ({
          id: turn.id || `legacy_conversation_${index}`,
          role: turn.speaker === 'user' ? 'user' : 'assistant',
          content: turn.text || turn.content || '',
          timestamp: turn.timestamp || new Date().toISOString()
        }))
      : []
    const messagesFromLegacyTurns = Array.isArray(conversationData?.turns)
      ? conversationData.turns.map((turn: any, index: number) => ({
          id: turn.id || `legacy_turn_${index}`,
          role: turn.role === 'user' ? 'user' : 'assistant',
          content: turn.text || turn.content || '',
          timestamp: turn.timestamp || new Date().toISOString()
        }))
      : []

    const messages =
      messagesFromCurrent.length > 0
        ? messagesFromCurrent
        : messagesFromLegacyConversation.length > 0
          ? messagesFromLegacyConversation
          : messagesFromLegacyTurns

    if (messages.length === 0) {
      return res.status(400).json({ error: 'No messages found in conversation' })
    }

    // Calculate basic metrics from text
    const userMessages = messages.filter((m: any) => m.role === 'user')
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant')

    // Helper functions
    const countWords = (text: string) => text.trim().split(/\s+/).filter(w => w.length > 0).length
    const countSentences = (text: string) => {
      // Count sentences by punctuation, but ensure at least 1 per non-empty text
      const byPunctuation = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length
      return Math.max(byPunctuation, text.trim().length > 0 ? 1 : 0)
    }
    const fillerWords = ['um', 'uh', 'like', 'you know', 'basically', 'actually', 'literally', 'so', 'well', 'right']
    const countFillers = (text: string) => {
      const lower = text.toLowerCase()
      return fillerWords.reduce((count, filler) => {
        const regex = new RegExp(`\\b${filler}\\b`, 'gi')
        return count + (lower.match(regex) || []).length
      }, 0)
    }
    const getUniqueWords = (text: string) => new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 2))

    // User metrics - count sentences per message for better accuracy in spoken text
    const userText = userMessages.map((m: any) => m.content || '').join(' ')
    const userWordCount = countWords(userText)
    // For spoken text, use number of messages as minimum sentence count
    const userSentenceCount = Math.max(
      userMessages.reduce((sum: number, m: any) => sum + countSentences(m.content || ''), 0),
      userMessages.length
    )
    const userFillerCount = countFillers(userText)
    const userUniqueWords = getUniqueWords(userText)

    // Assistant metrics
    const assistantText = assistantMessages.map((m: any) => m.content || '').join(' ')
    const assistantWordCount = countWords(assistantText)
    const assistantSentenceCount = Math.max(
      assistantMessages.reduce((sum: number, m: any) => sum + countSentences(m.content || ''), 0),
      assistantMessages.length
    )
    const assistantFillerCount = countFillers(assistantText)
    const assistantUniqueWords = getUniqueWords(assistantText)

    // Calculate time-based metrics from timestamps
    let totalDurationSec = 0
    let userResponseTimes: number[] = []
    let assistantResponseTimes: number[] = []

    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1]
      const curr = messages[i]
      const prevTime = new Date(prev.timestamp).getTime()
      const currTime = new Date(curr.timestamp).getTime()
      const diffSec = (currTime - prevTime) / 1000

      if (diffSec > 0 && diffSec < 300) { // Ignore gaps > 5 min
        if (curr.role === 'user' && prev.role === 'assistant') {
          userResponseTimes.push(diffSec)
        } else if (curr.role === 'assistant' && prev.role === 'user') {
          assistantResponseTimes.push(diffSec)
        }
      }
    }

    if (messages.length >= 2) {
      const firstTime = new Date(messages[0].timestamp).getTime()
      const lastTime = new Date(messages[messages.length - 1].timestamp).getTime()
      totalDurationSec = Math.max(0, (lastTime - firstTime) / 1000)
    }

    const avgUserResponseTime = userResponseTimes.length > 0 
      ? userResponseTimes.reduce((a, b) => a + b, 0) / userResponseTimes.length 
      : 0
    const avgAssistantResponseTime = assistantResponseTimes.length > 0 
      ? assistantResponseTimes.reduce((a, b) => a + b, 0) / assistantResponseTimes.length 
      : 0

    // Estimate speaking time (rough: 150 WPM average)
    const userSpeakingTime = (userWordCount / 150) * 60
    const assistantSpeakingTime = (assistantWordCount / 150) * 60

    // WPM estimates
    const userWpm = totalDurationSec > 0 ? Math.round((userWordCount / totalDurationSec) * 60) : 0
    const assistantWpm = totalDurationSec > 0 ? Math.round((assistantWordCount / totalDurationSec) * 60) : 0

    // Estimate tokens from text (1 token ≈ 4 characters for English)
    const totalChars = userText.length + assistantText.length
    const estimatedTokens = Math.ceil(totalChars / 4)
    
    // Estimate LLM processing time (based on assistant output at ~50 tokens/sec)
    const assistantTokens = Math.ceil(assistantText.length / 4)
    const estimatedLlmDuration = assistantTokens / 50

    const metricsData = {
      // User metrics
      userWpm: Math.min(userWpm, 200), // Cap at reasonable max
      userFillerCount,
      userFillerRate: userWordCount > 0 ? (userFillerCount / userWordCount) * 100 : 0,
      userAvgSentenceLength: userSentenceCount > 0 ? userWordCount / userSentenceCount : 0,
      userSpeakingTime,
      userVocabDiversity: userWordCount > 0 ? (userUniqueWords.size / userWordCount) * 100 : 0,
      userResponseTimeAvg: avgUserResponseTime,

      // Assistant metrics
      assistantWpm: Math.min(assistantWpm, 200),
      assistantFillerCount,
      assistantFillerRate: assistantWordCount > 0 ? (assistantFillerCount / assistantWordCount) * 100 : 0,
      assistantAvgSentenceLength: assistantSentenceCount > 0 ? assistantWordCount / assistantSentenceCount : 0,
      assistantSpeakingTime,
      assistantVocabDiversity: assistantWordCount > 0 ? (assistantUniqueWords.size / assistantWordCount) * 100 : 0,
      assistantResponseTimeAvg: avgAssistantResponseTime,

      // General metrics
      totalTurns: Math.floor(messages.length / 2),
      conversationLatencyAvg: avgAssistantResponseTime,
      
      // Token/Cost metrics (estimated from text)
      totalLlmTokens: estimatedTokens,
      totalLlmDuration: estimatedLlmDuration,
      avgTtft: avgAssistantResponseTime,
    }

    // Save to database
    await prisma.sessionMetrics.upsert({
      where: { sessionId },
      update: metricsData,
      create: { sessionId, ...metricsData }
    })

    res.json({
      message: 'Text-based metrics calculated successfully',
      sessionId,
      metrics: metricsData,
      stats: {
        totalMessages: messages.length,
        userMessages: userMessages.length,
        assistantMessages: assistantMessages.length,
        totalDurationSec,
        userWordCount,
        assistantWordCount
      }
    })

  } catch (error) {
    console.error('Error calculating text metrics:', error)
    res.status(500).json({ 
      error: 'Failed to calculate text metrics',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * Reprocess session metrics - triggers audio analysis (Gentle/Praat) on existing session
 * POST /sessions/:sessionId/reprocess
 */
export async function reprocessSessionMetrics(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    
    // Validate session exists
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        recordings: true,
        transcript: true
      }
    })

    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    // Pick best available recording for resumed sessions.
    const recordingPriority = ['user', 'room_composite', 'merged_audio', 'agent']
    const selectedRecording = recordingPriority
      .map((type) => session.recordings.find((r: any) => r.recordingType === type && r.filePath))
      .find(Boolean)

    // Build conversation transcript from conversation data
    let transcript = ''
    if (session.transcript && session.transcript.conversationData) {
      const conversationData = session.transcript.conversationData as any
      
      // Check for messages array (current structure)
      if (Array.isArray(conversationData.messages)) {
        transcript = conversationData.messages
          .filter((msg: any) => msg.role === 'user')
          .map((msg: any) => msg.content || msg.text)
          .join(' ')
      }
      // Fallback: check for turns array (older structure)
      else if (Array.isArray(conversationData.turns)) {
        transcript = conversationData.turns
          .filter((turn: any) => turn.role === 'user')
          .map((turn: any) => turn.text || turn.content)
          .join(' ')
      }
      // Legacy fallback: check for conversation array
      else if (Array.isArray(conversationData.conversation)) {
        transcript = conversationData.conversation
          .filter((turn: any) => turn.speaker === 'user' || turn.role === 'user')
          .map((turn: any) => turn.text || turn.content)
          .join(' ')
      }
    }

    if (!transcript.trim()) {
      return res.status(400).json({ 
        error: 'No transcript found. Session must have conversation data for audio analysis.',
        debug: {
          hasTranscript: !!session.transcript,
          hasConversationData: !!(session.transcript?.conversationData),
          conversationDataKeys: session.transcript?.conversationData ? Object.keys(session.transcript.conversationData) : []
        }
      })
    }

    // If no audio recording exists, gracefully fall back to text-based metric recalculation.
    if (!selectedRecording || !selectedRecording.filePath) {
      const textMetricsResp = await calculateTextMetrics(req, {
        status: (code: number) => ({
          json: (payload: any) => ({ code, payload })
        }),
        json: (payload: any) => ({ code: 200, payload })
      } as any)

      return res.json({
        message: 'No audio recording found. Recomputed metrics from transcript text instead.',
        sessionId,
        status: 'completed_text_fallback',
        recordingTypeUsed: null,
        result: textMetricsResp
      })
    }

    // Call Python reprocessing script
    // Convert /out/ path to local path
    const localAudioPath = selectedRecording.filePath.startsWith('/out/')
      ? selectedRecording.filePath.replace('/out/', join(__dirname, '../../../agent/audio_storage/'))
      : selectedRecording.filePath
    
    const pythonScript = join(__dirname, '../../../agent/reprocess_session.py')
    const pythonEnv = join(__dirname, '../../../agent/.venv312/bin/python')
    
    // Spawn Python process
    const python = spawn(pythonEnv, [pythonScript, sessionId, localAudioPath, transcript])
    
    let output = ''
    let errorOutput = ''
    
    python.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })
    
    python.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString()
    })
    
    // Wait for completion
    await new Promise<void>((resolve, reject) => {
      python.on('close', (code: number) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Python script exited with code ${code}: ${errorOutput}`))
        }
      })
    })
    
    const analysisResult = JSON.parse(output)

    res.json({
      message: 'Session reprocessing completed successfully',
      sessionId: sessionId,
      status: 'completed',
      recordingTypeUsed: selectedRecording.recordingType,
      result: analysisResult
    })

  } catch (error) {
    console.error('Error reprocessing session metrics:', error)
    res.status(500).json({ 
      error: 'Failed to reprocess session metrics',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
