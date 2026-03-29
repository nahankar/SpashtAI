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
import {
  saveAdvancedMetrics,
  getAdvancedMetrics
} from './routes/advanced-metrics'
import {
  analyzeSession,
  getSkillScores,
  getCoachingInsights,
  getCommunicationSignals
} from './routes/analytics'
import {
  getProgressPulse,
  getProgressPulseSummary,
  recordProgressPulse,
  skipProgressPulse,
  getCoachingContext
} from './routes/progress-pulse'
import downloadsRouter from './routes/downloads'
import replayRouter from './routes/replay'
import authRouter from './routes/auth'
import adminUsersRouter from './routes/admin/users'
import adminAnalyticsRouter from './routes/admin/analytics'
import adminSystemRouter from './routes/admin/system'
import ticketsRouter from './routes/tickets'
import adminTicketsRouter from './routes/admin/tickets'
import { ensureAdminExists } from './lib/init-admin'
import { requireAuth } from './middleware/auth'
import { requireAdmin } from './middleware/admin'
import { apiLimiter } from './middleware/rate-limit'

const app = express()
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())

app.use('/api/', apiLimiter)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Auth routes (authLimiter applied inside the router for login/register)
app.use('/api/auth', authRouter)

// Admin routes
app.use('/api/admin/users', requireAuth, requireAdmin, adminUsersRouter)
app.use('/api/admin/analytics', requireAuth, requireAdmin, adminAnalyticsRouter)
app.use('/api/admin/system', requireAuth, requireAdmin, adminSystemRouter)
app.use('/api/admin/tickets', requireAuth, requireAdmin, adminTicketsRouter)

// Protected: user tickets
app.use('/api/tickets', requireAuth, ticketsRouter)

// Public: LiveKit (has its own auth via API keys)
app.get('/livekit/token', getLivekitToken)
app.post('/livekit/dispatch', dispatchAgent)

// Public: personas (read-only reference data)
app.get('/personas', listPersonas)
app.get('/personas/:id', getPersona)

// Protected: sessions
app.get('/sessions', requireAuth, listSessions)
app.get('/sessions/:id', requireAuth, getSession)
app.post('/sessions', requireAuth, createSession)
app.post('/sessions/:id/end', requireAuth, endSession)
app.delete('/sessions/:id', requireAuth, deleteSession)

// Protected: settings
app.get('/settings', requireAuth, getSettings)
app.put('/settings', requireAuth, updateSettings)

// Protected: assistant
app.post('/assistant/text', requireAuth, assistantText)

// Protected: metrics and transcripts
app.post('/sessions/:sessionId/metrics', requireAuth, saveSessionMetrics)
app.post('/sessions/:sessionId/transcript', requireAuth, saveSessionTranscript)
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
app.post('/sessions/:sessionId/state', requireAuth, updateSessionState)
app.get('/conversations/search', requireAuth, searchConversations)

// Protected: audio storage
app.post('/sessions/:sessionId/audio', requireAuth, saveAudioMetadata)
app.post('/sessions/:sessionId/recording', requireAuth, saveRecording)
app.get('/sessions/:sessionId/audio', requireAuth, getSessionAudio)
app.get('/sessions/:sessionId/audio/:audioId/url', requireAuth, generateAudioUrl)
app.delete('/sessions/:sessionId/audio/:audioId', requireAuth, deleteSessionAudio)
app.get('/audio/analytics', requireAuth, getAudioAnalytics)

// Protected: advanced metrics
app.post('/sessions/:sessionId/advanced-metrics', requireAuth, saveAdvancedMetrics)
app.get('/sessions/:sessionId/advanced-metrics', requireAuth, getAdvancedMetrics)

// Protected: analytics engine v2
app.post('/sessions/:sessionId/analyze', requireAuth, analyzeSession)
app.get('/sessions/:sessionId/skill-scores', requireAuth, getSkillScores)
app.get('/sessions/:sessionId/coaching-insights', requireAuth, getCoachingInsights)
app.get('/sessions/:sessionId/communication-signals', requireAuth, getCommunicationSignals)

// Protected: My Progress Pulse
app.get('/api/progress-pulse', requireAuth, getProgressPulse)
app.get('/api/progress-pulse/summary', requireAuth, getProgressPulseSummary)
app.post('/api/progress-pulse', requireAuth, recordProgressPulse)
app.post('/api/progress-pulse/skip', requireAuth, skipProgressPulse)
app.get('/api/coaching-context', requireAuth, getCoachingContext)

// Protected: downloads and replay
app.use('/api/downloads', requireAuth, downloadsRouter)
app.use('/api/replay', requireAuth, replayRouter)

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

const port = process.env.PORT ? Number(process.env.PORT) : 4000

// Create HTTP server and WebSocket server for real-time updates
const server = createServer(app)
const wss = new WebSocketServer({ server })

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
  await ensureAdminExists()

  server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`)
    console.log(`WebSocket server ready for real-time conversation updates`)
  })
}

startServer().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})

