import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { WebSocketServer, WebSocket } from 'ws'

let wss: WebSocketServer | null = null

const clientSessions = new WeakMap<WebSocket, Set<string>>()
const INTERNAL_AGENT_TOKEN = process.env.INTERNAL_AGENT_TOKEN || 'dev-internal-agent-token'

export function setWebSocketServer(webSocketServer: WebSocketServer) {
  wss = webSocketServer
}

export function subscribeClientToSession(client: WebSocket, sessionId: string) {
  let sessions = clientSessions.get(client)
  if (!sessions) {
    sessions = new Set()
    clientSessions.set(client, sessions)
  }
  sessions.add(sessionId)
}

function broadcastToSession(sessionId: string, message: any) {
  if (!wss) return
  
  const data = JSON.stringify({
    type: 'conversation_update',
    sessionId,
    ...message
  })
  
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState !== WebSocket.OPEN) return
    const sessions = clientSessions.get(client)
    if (sessions && sessions.has(sessionId)) {
      client.send(data)
    }
  })
}

export async function addConversationMessage(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const { role, content, timestamp, audio_url } = req.body
    
    if (!role || !content) {
      return res.status(400).json({ error: 'Role and content are required' })
    }
    
    let session = await prisma.session.findUnique({
      where: { id: sessionId }
    })
    
    if (!session) {
      if (!req.user?.userId) {
        return res.status(404).json({ error: 'Session not found for internal message logging' })
      }
      session = await prisma.session.create({
        data: {
          id: sessionId,
          userId: req.user.userId,
          module: 'elevate'
        }
      })
    }
    
    const messageData = {
      id: `${role}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      role,
      content,
      timestamp: timestamp || new Date().toISOString(),
      ...(audio_url && { audio_url }) // Include audio_url if provided
    }

    // Robust against concurrent first writes (user + assistant message at session start).
    // We retry once if another request creates the transcript between read and create.
    let transcript: any = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await prisma.sessionTranscript.findUnique({
        where: { sessionId },
      })

      if (existing) {
        const conversationData = existing.conversationData as any
        const messages = Array.isArray(conversationData.messages) ? conversationData.messages : []
        messages.push(messageData)

        transcript = await prisma.sessionTranscript.update({
          where: { sessionId },
          data: {
            conversationData: {
              ...conversationData,
              messages,
              lastUpdated: new Date().toISOString(),
            },
          },
        })
        break
      }

      try {
        transcript = await prisma.sessionTranscript.create({
          data: {
            sessionId,
            conversationData: {
              messages: [messageData],
              created: new Date().toISOString(),
              lastUpdated: new Date().toISOString(),
            },
          },
        })
        break
      } catch (e: any) {
        // P2002 = another concurrent request created it first; retry as update path.
        if (e?.code !== 'P2002' || attempt === 1) throw e
      }
    }
    
    // Broadcast to WebSocket clients for real-time updates
    broadcastToSession(sessionId, {
      action: 'message_added',
      message: messageData
    })
    
    res.status(201).json({ 
      success: true, 
      message: messageData,
      transcriptId: transcript.id
    })
  } catch (error) {
    console.error('❌ Error adding conversation message:', error)
    console.error('  SessionId:', req.params.sessionId)
    console.error('  Request body:', req.body)
    console.error('  Error details:', error instanceof Error ? error.message : String(error))
    console.error('  Stack:', error instanceof Error ? error.stack : 'No stack trace')
    res.status(500).json({ 
      error: 'Failed to add conversation message',
      details: error instanceof Error ? error.message : String(error)
    })
  }
}

export async function addConversationMessageForAgent(req: Request, res: Response) {
  const token = req.header('x-internal-agent-token')
  if (!token || token !== INTERNAL_AGENT_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized internal agent request' })
  }
  return addConversationMessage(req, res)
}

export async function getConversation(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    
    const transcript = await prisma.sessionTranscript.findUnique({
      where: { sessionId },
      include: {
        session: {
          include: {
            user: {
              select: { id: true, email: true }
            }
          }
        }
      }
    })
    
    if (!transcript) {
      return res.json({
        sessionId,
        messages: [],
        metadata: {
          created: null,
          lastUpdated: null,
          totalMessages: 0
        },
        session: null
      })
    }
    
    const conversationData = transcript.conversationData as any
    const messages = Array.isArray(conversationData.messages) ? conversationData.messages : []
    
    res.json({
      sessionId,
      messages,
      metadata: {
        created: conversationData.created,
        lastUpdated: conversationData.lastUpdated,
        totalMessages: messages.length
      },
      session: transcript.session
    })
  } catch (error) {
    console.error('Error getting conversation:', error)
    res.status(500).json({ error: 'Failed to get conversation' })
  }
}

/**
 * Internal endpoint for agent resume-memory lookups.
 * Uses a shared header token instead of user JWT because agent is server-side.
 */
export async function getConversationForAgent(req: Request, res: Response) {
  try {
    const token = req.header('x-internal-agent-token')
    const expected = process.env.INTERNAL_AGENT_TOKEN || 'dev-internal-agent-token'
    if (!token || token !== expected) {
      return res.status(401).json({ error: 'Unauthorized internal agent request' })
    }

    const { sessionId } = req.params

    const transcript = await prisma.sessionTranscript.findUnique({
      where: { sessionId },
    })

    if (!transcript) {
      return res.json({
        sessionId,
        messages: [],
        metadata: {
          created: null,
          lastUpdated: null,
          totalMessages: 0,
        },
      })
    }

    const conversationData = transcript.conversationData as any
    const messages = Array.isArray(conversationData.messages) ? conversationData.messages : []

    res.json({
      sessionId,
      messages,
      metadata: {
        created: conversationData.created,
        lastUpdated: conversationData.lastUpdated,
        totalMessages: messages.length,
      },
    })
  } catch (error) {
    console.error('Error getting conversation for agent:', error)
    res.status(500).json({ error: 'Failed to get conversation' })
  }
}

export async function updateSessionState(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const { state, metadata } = req.body
    
    // Broadcast session state to WebSocket clients
    broadcastToSession(sessionId, {
      action: 'session_state_changed',
      state,
      metadata,
      timestamp: new Date().toISOString()
    })
    
    res.json({ success: true })
  } catch (error) {
    console.error('Error updating session state:', error)
    res.status(500).json({ error: 'Failed to update session state' })
  }
}

export async function searchConversations(req: Request, res: Response) {
  try {
    const { userId, query, module, limit = 10, offset = 0 } = req.query
    
    const whereConditions: any = {}
    
    if (userId) {
      whereConditions.session = {
        userId: userId as string
      }
    }
    
    if (module) {
      whereConditions.session = {
        ...whereConditions.session,
        module: module as string
      }
    }
    
    const transcripts = await prisma.sessionTranscript.findMany({
      where: whereConditions,
      include: {
        session: {
          include: {
            user: {
              select: { id: true, email: true }
            }
          }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: Number(limit),
      skip: Number(offset)
    })
    
    // Filter by text query if provided
    let filteredTranscripts = transcripts
    if (query) {
      const searchTerm = (query as string).toLowerCase()
      filteredTranscripts = transcripts.filter((transcript: any) => {
        const conversationData = transcript.conversationData as any
        const messages = Array.isArray(conversationData.messages) ? conversationData.messages : []
        return messages.some((msg: any) => 
          msg.content && msg.content.toLowerCase().includes(searchTerm)
        )
      })
    }
    
    const results = filteredTranscripts.map((transcript: any) => {
      const conversationData = transcript.conversationData as any
      const messages = Array.isArray(conversationData.messages) ? conversationData.messages : []
      
      return {
        sessionId: transcript.sessionId,
        preview: messages.slice(0, 3).map((msg: any) => ({
          role: msg.role,
          content: msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '')
        })),
        totalMessages: messages.length,
        lastUpdated: conversationData.lastUpdated,
        session: transcript.session
      }
    })
    
    res.json({
      conversations: results,
      pagination: {
        limit: Number(limit),
        offset: Number(offset),
        total: filteredTranscripts.length
      }
    })
  } catch (error) {
    console.error('Error searching conversations:', error)
    res.status(500).json({ error: 'Failed to search conversations' })
  }
}