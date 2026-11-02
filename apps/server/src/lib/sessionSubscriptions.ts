import { WebSocket } from 'ws'
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { verifyToken } from './jwt'

type SessionDb = Pick<Prisma.TransactionClient, 'session'>
type Socket = Pick<WebSocket, 'readyState' | 'send'>
export async function canSubscribeToPersonalSession(token: string, sessionId: string, db: SessionDb = prisma) {
  try {
    const identity = verifyToken(token)
    if (typeof identity.userId !== 'string' || !identity.userId) return false
    return Boolean(await db.session.findFirst({ where: { id: sessionId, userId: identity.userId, workspaceKind: 'PERSONAL', discardedAt: null }, select: { id: true } }))
  } catch { return false }
}

export class SessionSubscriptions {
  private subscriptions = new WeakMap<Socket, Map<string, string>>()
  async subscribe(socket: Socket, sessionId: unknown, token: unknown, db?: SessionDb) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 160 || typeof token !== 'string' || token.length > 8192) return false
    if (!await canSubscribeToPersonalSession(token, sessionId, db)) return false
    const subscriptions = this.subscriptions.get(socket) ?? new Map<string, string>()
    if (!subscriptions.has(sessionId) && subscriptions.size >= 10) return false
    subscriptions.set(sessionId, token)
    this.subscriptions.set(socket, subscriptions)
    return true
  }
  async publish(clients: Iterable<Socket>, sessionId: string, message: unknown, db?: SessionDb) {
    const data = JSON.stringify({ type: 'conversation_update', sessionId, ...(message as Record<string, unknown>) })
    await Promise.all([...clients].map(async client => {
      if (client.readyState !== WebSocket.OPEN) return
      const subscriptions = this.subscriptions.get(client)
      const token = subscriptions?.get(sessionId)
      if (!token) return
      // Expiry, ownership, discard and Personal scope are checked for each event.
      if (!await canSubscribeToPersonalSession(token, sessionId, db)) {
        subscriptions!.delete(sessionId)
        try { client.send(JSON.stringify({ type: 'subscription_error', sessionId, code: 'ACCESS_UNAVAILABLE' })) } catch { /* closed meanwhile */ }
        return
      }
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(data) } catch { /* closed meanwhile */ }
      }
    }))
  }
}
