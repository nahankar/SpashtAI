import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import path from 'path'
import { getLivekitToken, dispatchAgent } from './routes/livekit'
import { listPersonas, getPersona } from './routes/personas'
import { listSessions, getSession, createSession, endSession, saveTranscript, saveRecording, deleteSession } from './routes/sessions'
import { getSettings, updateSettings } from './routes/settings'
import { assistantText } from './routes/assistant'
import { 
  saveSessionMetrics, 
  saveSessionTranscript, 
  getSessionMetrics, 
  getSessionTranscript, 
  downloadSessionTranscript,
  getUserSessionsMetrics,
  reprocessSessionMetrics,
  calculateTextMetrics
} from './routes/metrics'
import {
  addConversationMessage,
  addConversationMessageForAgent,
  getConversation,
  getConversationForAgent,
  updateSessionState,
  searchConversations,
  setWebSocketServer,
  subscribeClientToSession
} from './routes/conversations'
import {
  saveAudioMetadata,
  getSessionAudio,
  generateAudioUrl,
  deleteSessionAudio,
  getAudioAnalytics
} from './routes/audio'
import { getSessionTurns, saveSessionTurnsForAgent } from './routes/turns'
import {
  recordingUpload,
  uploadSessionRecording,
  streamSessionRecording,
} from './routes/recordings'
import { createSessionSegment, closeSessionSegment } from './routes/session-segments'
import {
  saveAdvancedMetrics,
  getAdvancedMetrics
} from './routes/advanced-metrics'
import {
  analyzeSession,
  getSkillScores,
  getCoachingInsights,
  getCommunicationSignals,
  getTurnSuggestions
} from './routes/analytics'
import {
  getProgressPulse,
  getProgressPulseSummary,
  recordProgressPulse,
  skipProgressPulse,
  getCoachingContext,
  getCoachingContextForAgent
} from './routes/progress-pulse'
import downloadsRouter from './routes/downloads'
import replayRouter from './routes/replay'
import authRouter from './routes/auth'
import adminUsersRouter from './routes/admin/users'
import adminAnalyticsRouter from './routes/admin/analytics'
import adminSystemRouter from './routes/admin/system'
import adminVoiceConfigRouter, { ensurePresets as ensureVoicePresets } from './routes/admin/voice-config'
import adminAnalysisConfigRouter from './routes/admin/analysis-config'
import adminFeatureFlagsRouter from './routes/admin/feature-flags'
import adminAgentPromptsRouter, { ensurePrompts } from './routes/admin/agent-prompts'
import internalAgentPromptsRouter from './routes/internal/agent-prompts'
import feedbackRouter from './routes/feedback'
import coachRouter from './routes/coach'
import adminFeedbackRouter from './routes/admin/feedback'
import adminTickersRouter from './routes/admin/tickers'
import adminPricingRouter from './routes/admin/pricing'
import adminLegalRouter from './routes/admin/legal'
import adminPlatformRouter from './routes/admin/platform'
import preparationsRouter from './routes/preparations'
import legalRouter from './routes/legal'
import { getPublicTickers } from './routes/tickers'
import { getPublicPricing } from './routes/pricing'
import { getPublicFeatures } from './routes/features'
import { getPublicPlatform } from './routes/platform'
import { ensureAdminExists } from './lib/init-admin'
import { ensureLegalDocuments } from './lib/ensure-legal'
import { requireAuth, requireAuthOrAgent, requireAuthOrMediaToken } from './middleware/auth'
import { requireAdmin } from './middleware/admin'
import { trackFeatureUsage } from './middleware/tracking'
import eventsRouter from './routes/events'
import { requireFeature, ensureFeatureFlags } from './lib/featureFlags'
import { ensurePlatformSettings, getPlatformSettings } from './lib/platformSettings'
import { apiLimiter, setAdminRateLimitBypassEnabled } from './middleware/rate-limit'
import { ingestClientLogs, clientLogsLimiter } from './routes/clientLogs'
import { logger } from './lib/logger'
import pino from 'pino'
import pinoHttp from 'pino-http'
import { randomUUID } from 'crypto'
import { prisma } from './lib/prisma'
import { discardedSessionGuard } from './lib/sessionDiscard'
import { startSessionDeletionWorker } from './lib/sessionDeletionWorker'

const app = express()
// Cloudflare → Nginx → Express; required for rate limiting and client IP
app.set('trust proxy', 1)

// Structured request logging (one JSON line per request, at completion).
// Logs at response 'finish', so req.user (set by requireAuth) is available.
// Honors an inbound x-request-id and echoes it back; correlates to a session
// via the optional x-conversation-id header (the client's sessionId).
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const hdr = req.headers['x-request-id']
      const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID()
      res.setHeader('x-request-id', id)
      return id
    },
    customProps: (req) => {
      const conv = req.headers['x-conversation-id']
      return {
        userId: (req as { user?: { userId?: string } }).user?.userId,
        sessionId: (Array.isArray(conv) ? conv[0] : conv) || undefined,
      }
    },
    // Health checks would otherwise dominate the log volume.
    autoLogging: { ignore: (req) => req.url === '/health' },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'info'
    },
    // redact() covers headers/query, but the access_token also rides in the raw
    // URL of media routes — strip it there so playback tokens never hit the logs.
    serializers: {
      req: pino.stdSerializers.wrapRequestSerializer((req) => {
        if (typeof req.url === 'string' && req.url.includes('access_token=')) {
          req.url = req.url.replace(/([?&]access_token=)[^&]+/gi, '$1[redacted]')
        }
        return req
      }),
    },
  }),
)

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())

app.use('/api/', apiLimiter)
app.use(discardedSessionGuard)

// Liveness: process is up. Cheap, dependency-free (kept as-is for uptime pings).
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Readiness: verifies the DB is actually reachable, so a monitor/alarm can tell
// "process up but database down" apart from a healthy box. Bounded so a hung DB
// can't hang the probe.
app.get('/ready', async (_req, res) => {
  const query = prisma.$queryRaw`SELECT 1`
  // If the query loses the race and rejects later, swallow it so it can't surface
  // as an unhandledRejection.
  query.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      query,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('db timeout')), 2000)
      }),
    ])
    res.json({ status: 'ready' })
  } catch (err) {
    logger.warn({ err }, 'readiness check failed')
    res.status(503).json({ status: 'unavailable' })
  } finally {
    if (timer) clearTimeout(timer)
  }
})

// Public: platform feature flags (no secrets — drives nav visibility)
app.get('/api/features', getPublicFeatures)
app.get('/api/platform', getPublicPlatform)
app.get('/api/tickers', getPublicTickers)
app.get('/api/pricing', getPublicPricing)
app.use('/api/legal', legalRouter)

// Auth routes (authLimiter applied inside the router for login/register)
app.use('/api/auth', authRouter)

// Browser remote logs → S3 (operational only; gated by CLIENT_LOGS_ENABLED).
// Fail-safe: never blocks or errors the app; no-ops when disabled.
app.post('/api/client-logs', clientLogsLimiter, requireAuth, ingestClientLogs)

// Admin routes
app.use('/api/admin/users', requireAuth, requireAdmin, adminUsersRouter)
app.use('/api/admin/analytics', requireAuth, requireAdmin, adminAnalyticsRouter)
app.use('/api/admin/system', requireAuth, requireAdmin, adminSystemRouter)
app.use('/api/admin/voice-config', requireAuth, requireAdmin, adminVoiceConfigRouter)
app.use('/api/admin/analysis-config', requireAuth, requireAdmin, adminAnalysisConfigRouter)
app.use('/api/admin/feature-flags', requireAuth, requireAdmin, adminFeatureFlagsRouter)
app.use('/api/admin/agent-prompts', requireAuth, requireAdmin, adminAgentPromptsRouter)
app.use('/api/admin/tickers', requireAuth, requireAdmin, adminTickersRouter)
app.use('/api/admin/pricing', requireAuth, requireAdmin, adminPricingRouter)
app.use('/api/admin/legal', requireAuth, requireAdmin, adminLegalRouter)
app.use('/api/admin/platform', requireAuth, requireAdmin, adminPlatformRouter)
app.use('/api/admin/feedback', requireAuth, requireAdmin, adminFeedbackRouter)

// Protected: product event tracking (page views, etc.)
app.use('/api/events', requireAuth, eventsRouter)

// Protected: user feedback
app.use('/api/feedback', requireAuth, feedbackRouter)
app.use('/api/coach', requireAuth, coachRouter)

// Protected: Prepare interview journeys
app.use('/api/preparations', requireAuth, requireFeature('prepare'), preparationsRouter)

// Public: LiveKit (has its own auth via API keys) — Elevate only
app.get('/livekit/token', requireFeature('elevate'), getLivekitToken)
app.post('/livekit/dispatch', requireFeature('elevate'), dispatchAgent)

// Public: personas (read-only reference data)
app.get('/personas', listPersonas)
app.get('/personas/:id', getPersona)

// Protected: sessions (Elevate live coaching)
app.get('/sessions', requireAuth, requireFeature('elevate'), listSessions)
app.get('/sessions/:id', requireAuth, requireFeature('elevate'), getSession)
app.post('/sessions', requireAuth, requireFeature('elevate'), trackFeatureUsage('elevate', 'session_start'), createSession)
app.post('/sessions/:id/end', requireAuthOrAgent, requireFeature('elevate'), trackFeatureUsage('elevate', 'session_end'), endSession)
app.delete('/sessions/:id', requireAuth, requireFeature('elevate'), deleteSession)

// Protected: settings
app.get('/settings', requireAuth, getSettings)
app.put('/settings', requireAuth, updateSettings)

// Protected: assistant
app.post('/assistant/text', requireAuth, assistantText)

// Protected: metrics and transcripts
// POST endpoints accept either a user JWT or the agent's internal token, since
// the LiveKit Python worker also writes metrics at session end.
app.post('/sessions/:sessionId/metrics', requireAuthOrAgent, saveSessionMetrics)
app.post('/sessions/:sessionId/transcript', requireAuthOrAgent, saveSessionTranscript)
app.get('/sessions/:sessionId/metrics', requireAuth, getSessionMetrics)
app.get('/sessions/:sessionId/transcript', requireAuth, getSessionTranscript)
app.get('/sessions/:sessionId/transcript/download', requireAuth, downloadSessionTranscript)
app.get('/users/:userId/sessions/metrics', requireAuth, getUserSessionsMetrics)
app.post('/sessions/:sessionId/reprocess', requireAuth, reprocessSessionMetrics)
app.post('/sessions/:sessionId/calculate-text-metrics', requireAuth, calculateTextMetrics)

// Protected: conversations
app.post('/sessions/:sessionId/messages', requireAuth, addConversationMessage)
app.get('/sessions/:sessionId/conversation', requireAuth, getConversation)
app.post('/internal/sessions/:sessionId/messages', addConversationMessageForAgent)
app.get('/internal/sessions/:sessionId/conversation', getConversationForAgent)
app.get('/internal/coaching-context', getCoachingContextForAgent)
app.use('/internal/agent-prompts', internalAgentPromptsRouter)
app.post('/sessions/:sessionId/state', requireAuth, updateSessionState)
app.get('/conversations/search', requireAuth, searchConversations)

// Protected: audio storage
// POST endpoints accept agent token because the LiveKit worker uploads
// recordings server-side.
app.post('/sessions/:sessionId/audio', requireAuthOrAgent, saveAudioMetadata)
app.post('/sessions/:sessionId/recording', requireAuthOrAgent, saveRecording)
app.get('/sessions/:sessionId/audio', requireAuth, getSessionAudio)
app.get('/sessions/:sessionId/audio/:audioId/url', requireAuth, generateAudioUrl)
app.delete('/sessions/:sessionId/audio/:audioId', requireAuth, deleteSessionAudio)
app.get('/audio/analytics', requireAuth, getAudioAnalytics)

// Protected: client-captured recording upload + streamable playback (replay)
app.post(
  '/sessions/:sessionId/recording/upload',
  requireAuth,
  recordingUpload.single('audio'),
  uploadSessionRecording,
)
app.get('/sessions/:sessionId/recording/stream', requireAuthOrMediaToken, streamSessionRecording)
app.post('/sessions/:sessionId/segments', requireAuth, createSessionSegment)
app.patch('/sessions/:sessionId/segments/:segmentId', requireAuth, closeSessionSegment)

// Protected: per-turn replay records (GET user, POST agent-internal)
app.get('/sessions/:sessionId/turns', requireAuth, getSessionTurns)
app.post('/internal/sessions/:sessionId/turns', saveSessionTurnsForAgent)

// Protected: advanced metrics
// POST is agent-callable; GET stays user-only.
app.post('/sessions/:sessionId/advanced-metrics', requireAuthOrAgent, saveAdvancedMetrics)
app.get('/sessions/:sessionId/advanced-metrics', requireAuth, getAdvancedMetrics)

// Protected: analytics engine v2
// Accepts the agent's internal token so analytics run at session end even if
// the user closes the tab before the frontend can trigger /analyze.
app.post('/sessions/:sessionId/analyze', requireAuthOrAgent, analyzeSession)
app.get('/sessions/:sessionId/skill-scores', requireAuthOrAgent, getSkillScores)
app.get('/sessions/:sessionId/coaching-insights', requireAuth, getCoachingInsights)
app.get('/sessions/:sessionId/communication-signals', requireAuth, getCommunicationSignals)
app.get('/sessions/:sessionId/turn-suggestions', requireAuth, getTurnSuggestions)

// Protected: My Progress Pulse
app.get('/api/progress-pulse', requireAuth, getProgressPulse)
app.get('/api/progress-pulse/summary', requireAuth, getProgressPulseSummary)
app.post('/api/progress-pulse', requireAuth, recordProgressPulse)
app.post('/api/progress-pulse/skip', requireAuth, skipProgressPulse)
app.get('/api/coaching-context', requireAuth, getCoachingContext)

// Protected: downloads and replay
app.use('/api/downloads', requireAuth, downloadsRouter)
app.use('/api/replay', requireAuth, requireFeature('replay'), replayRouter)

// local audio serving for development
app.get('/audio/local/:date/:sessionId/:filename', (req, res) => {
  const { date, sessionId, filename } = req.params
  const filePath = path.join(date, sessionId, filename)
  const audioPath = path.join(process.env.LOCAL_AUDIO_PATH || './audio_storage', filePath)
  
  // Security check: ensure path is within audio storage directory
  const resolvedPath = path.resolve(audioPath)
  const audioStorageRoot = path.resolve(process.env.LOCAL_AUDIO_PATH || './audio_storage')
  
  if (!resolvedPath.startsWith(audioStorageRoot)) {
    return res.status(403).json({ error: 'Access denied' })
  }
  
  res.sendFile(resolvedPath, (err) => {
    if (err) {
      console.error('Error serving local audio:', err)
      res.status(404).json({ error: 'Audio file not found' })
    }
  })
})

// Central error handler — safety net for errors that propagate to Express
// (most routes still handle their own errors and return their own shapes; this
// catches the rest instead of leaking a stack trace or hanging the request).
// Must be registered after all routes. Honors err.status for client errors
// (e.g. malformed JSON body) and hides internal details on 5xx.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const status = Number(err?.status || err?.statusCode) || 500
  ;((req as { log?: typeof logger }).log || logger).error(
    { err, status },
    'unhandled request error',
  )
  if (res.headersSent) return next(err)
  res.status(status).json({
    error: status < 500 ? err?.message || 'Bad request' : 'Internal server error',
  })
})

const port = process.env.PORT ? Number(process.env.PORT) : 4000

// Create HTTP server and WebSocket server for real-time updates
const server = createServer(app)
const wss = new WebSocketServer({ server })

// Without an 'error' listener the WebSocketServer (attached to the HTTP server)
// rethrows a fatal listen error (e.g. EADDRINUSE), crashing the process. Handle
// it so a transient port conflict during a dev hot-reload is recoverable.
wss.on('error', (err) => {
  console.warn('⚠️  WebSocket server error:', (err as Error)?.message || err)
})

// Set up WebSocket server for conversation routes
setWebSocketServer(wss)

wss.on('connection', (ws) => {
  console.log('WebSocket client connected')
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString())
      if (data.type === 'subscribe' && data.sessionId) {
        subscribeClientToSession(ws, data.sessionId)
      }
    } catch (error) {
      console.error('Invalid WebSocket message:', error)
    }
  })
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected')
  })
})

async function startServer() {
  if (process.env.NODE_ENV === 'production' && !process.env.INTERNAL_AGENT_TOKEN?.trim()) {
    throw new Error('INTERNAL_AGENT_TOKEN must be set in production')
  }

  await ensureAdminExists()
  try {
    await ensureFeatureFlags()
  } catch (err) {
    console.warn('⚠️  Feature flag seeding failed:', err)
  }
  try {
    await ensurePrompts()
  } catch (err) {
    console.warn('⚠️  Agent prompt seeding failed:', err)
  }
  try {
    await ensureVoicePresets()
  } catch (err) {
    console.warn('⚠️  Voice config preset seeding failed:', err)
  }
  try {
    await ensureLegalDocuments()
  } catch (err) {
    console.warn('⚠️  Legal document seeding failed:', err)
  }
  try {
    await ensurePlatformSettings()
    const platformSettings = await getPlatformSettings()
    setAdminRateLimitBypassEnabled(platformSettings.adminRateLimitBypass)
  } catch (err) {
    console.warn('⚠️  Platform settings seeding failed:', err)
  }

  startSessionDeletionWorker()

  // During `tsx watch` hot-reloads the previous process can still hold the port
  // for a brief moment when the new one starts. Instead of crashing on
  // EADDRINUSE, retry a few times so the reload settles on its own.
  let listenRetries = 0
  const MAX_LISTEN_RETRIES = 10
  const LISTEN_RETRY_DELAY_MS = 400

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && listenRetries < MAX_LISTEN_RETRIES) {
      listenRetries += 1
      console.warn(
        `⚠️  Port ${port} busy (likely a reload in progress) — retry ${listenRetries}/${MAX_LISTEN_RETRIES} in ${LISTEN_RETRY_DELAY_MS}ms`,
      )
      setTimeout(() => {
        server.close()
        server.listen(port)
      }, LISTEN_RETRY_DELAY_MS)
      return
    }
    console.error('Server error:', err)
    process.exit(1)
  })

  server.listen(port, () => {
    listenRetries = 0
    console.log(`Server listening on http://localhost:${port}`)
    console.log(`WebSocket server ready for real-time conversation updates`)
  })

  // Release the port promptly on shutdown/reload so the next process can bind
  // immediately (prevents the EADDRINUSE reload race in the first place).
  const shutdown = (signal: string) => {
    console.log(`${signal} received — shutting down server gracefully`)
    server.close(() => process.exit(0))
    // Don't hang forever if connections are slow to drain.
    setTimeout(() => process.exit(0), 3000).unref()
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))
}

startServer().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})

