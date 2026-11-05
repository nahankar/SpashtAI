import { WebSocket } from 'ws'
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { verifyToken, verifyWorkspaceToken } from './jwt'
import { runWithDataScope } from './dataScope'
import { resolveRequestScope } from '../workspaces/requestScope'

type SessionDb = Pick<Prisma.TransactionClient, 'session'>
type Socket = Pick<WebSocket, 'readyState' | 'send'>
type Grant = { token: string; workspaceToken?: string }

export async function canSubscribeToPersonalSession(token: string, sessionId: string, db: SessionDb = prisma) {
  try {
    const identity = verifyToken(token)
    if (typeof identity.userId !== 'string' || !identity.userId) return false
    return Boolean(await db.session.findFirst({ where: { id: sessionId, userId: identity.userId, workspaceKind: 'PERSONAL', discardedAt: null, user: { tenantOnly: false } }, select: { id: true } }))
  } catch { return false }
}

/** Current membership, matching identity and own, undiscarded organization session. */
export async function canSubscribeToWorkspaceSession(token: string, workspaceToken: string, sessionId: string) {
  try {
    const identity = verifyToken(token)
    const claims = verifyWorkspaceToken(workspaceToken)
    if (!identity.userId || identity.userId !== claims.userId) return false
    const scope = await resolveRequestScope(claims)
    return await runWithDataScope(scope, async () => Boolean(await prisma.session.findFirst({
      where: { id: sessionId, userId: identity.userId, workspaceId: scope.workspaceId, discardedAt: null }, select: { id: true },
    })))
  } catch { return false }
}

function allowed(grant: Grant, sessionId: string, db?: SessionDb) {
  return grant.workspaceToken
    ? canSubscribeToWorkspaceSession(grant.token, grant.workspaceToken, sessionId)
    : canSubscribeToPersonalSession(grant.token, sessionId, db)
}

export class SessionSubscriptions {
  private subscriptions = new WeakMap<Socket, Map<string, Grant>>()
  async subscribe(socket: Socket, sessionId: unknown, token: unknown, db?: SessionDb, workspaceToken?: unknown) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 160 || typeof token !== 'string' || token.length > 8192) return false
    if (workspaceToken !== undefined && (typeof workspaceToken !== 'string' || !workspaceToken || workspaceToken.length > 8192)) return false
    const grant: Grant = { token, ...(workspaceToken ? { workspaceToken: workspaceToken as string } : {}) }
    if (!await allowed(grant, sessionId, db)) return false
    const subscriptions = this.subscriptions.get(socket) ?? new Map<string, Grant>()
    if (!subscriptions.has(sessionId) && subscriptions.size >= 10) return false
    subscriptions.set(sessionId, grant)
    this.subscriptions.set(socket, subscriptions)
    return true
  }
  async publish(clients: Iterable<Socket>, sessionId: string, message: unknown, db?: SessionDb) {
    const data = JSON.stringify({ type: 'conversation_update', sessionId, ...(message as Record<string, unknown>) })
    await Promise.all([...clients].map(async client => {
      if (client.readyState !== WebSocket.OPEN) return
      const subscriptions = this.subscriptions.get(client)
      const grant = subscriptions?.get(sessionId)
      if (!grant) return
      // Expiry, ownership, discard, membership and scope are checked for each event.
      if (!await allowed(grant, sessionId, db)) {
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
