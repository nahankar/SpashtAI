import jwt from 'jsonwebtoken'

const DEFAULT_SECRET = 'dev-secret-change-me'
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_SECRET
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d'

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_SECRET)) {
  throw new Error('FATAL: JWT_SECRET must be set to a secure value in production')
}

export interface TokenPayload {
  userId: string
  email: string
  role: string
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY } as jwt.SignOptions)
}

export function verifyToken(token: string): TokenPayload {
  const payload = jwt.verify(token, JWT_SECRET)
  if (typeof payload === 'string' || (payload.tokenUse && payload.tokenUse !== 'identity')) {
    throw new Error('An identity token is required')
  }
  return payload as TokenPayload
}

export interface WorkspaceTokenPayload {
  tokenUse: 'workspace'
  userId: string
  workspaceId: string
  membershipId: string
}

/** Deliberately separate from identity tokens: legacy product/Admin routes reject these. */
export function signWorkspaceToken(input: Omit<WorkspaceTokenPayload, 'tokenUse'>): string {
  return jwt.sign({ ...input, tokenUse: 'workspace' }, JWT_SECRET, {
    expiresIn: '15m', audience: 'workspace-api', issuer: 'spashtai-workspace',
  })
}

export interface AgentScopeTokenPayload {
  tokenUse: 'agent-scope'
  sessionId: string
  userId: string
  workspaceId: string
  membershipId: string
}

/**
 * Binds one organization voice session to its workspace and learner. It is only
 * honoured together with the internal agent secret; on its own it grants nothing.
 */
export function signAgentScopeToken(input: Omit<AgentScopeTokenPayload, 'tokenUse'>): string {
  return jwt.sign({ ...input, tokenUse: 'agent-scope' }, JWT_SECRET, {
    expiresIn: '36h', audience: 'agent-callback', issuer: 'spashtai-workspace',
  })
}

export function verifyAgentScopeToken(token: string): AgentScopeTokenPayload {
  const payload = jwt.verify(token, JWT_SECRET, { audience: 'agent-callback', issuer: 'spashtai-workspace' })
  if (typeof payload === 'string' || payload.tokenUse !== 'agent-scope'
    || ![payload.sessionId, payload.userId, payload.workspaceId, payload.membershipId].every(v => typeof v === 'string' && v.length > 0)) {
    throw new Error('An agent scope token is required')
  }
  return payload as AgentScopeTokenPayload
}

export function verifyWorkspaceToken(token: string): WorkspaceTokenPayload {
  const payload = jwt.verify(token, JWT_SECRET, { audience: 'workspace-api', issuer: 'spashtai-workspace' })
  if (typeof payload === 'string' || payload.tokenUse !== 'workspace'
    || ![payload.userId, payload.workspaceId, payload.membershipId].every(v => typeof v === 'string' && v.length > 0)) {
    throw new Error('A workspace token is required')
  }
  return payload as WorkspaceTokenPayload
}

export interface WorkspaceMediaTokenPayload {
  tokenUse: 'workspace-media'
  userId: string
  workspaceId: string
  membershipId: string
  sessionId: string
}

/**
 * Playback ticket for `<audio src>`, which cannot send the workspace header. It names one
 * session and outlives a long playback; membership is still re-resolved on every range request.
 */
export function signWorkspaceMediaToken(input: Omit<WorkspaceMediaTokenPayload, 'tokenUse'>): string {
  return jwt.sign({ ...input, tokenUse: 'workspace-media' }, JWT_SECRET, {
    expiresIn: '2h', audience: 'workspace-media', issuer: 'spashtai-workspace',
  })
}

export function verifyWorkspaceMediaToken(token: string): WorkspaceMediaTokenPayload {
  const payload = jwt.verify(token, JWT_SECRET, { audience: 'workspace-media', issuer: 'spashtai-workspace' })
  if (typeof payload === 'string' || payload.tokenUse !== 'workspace-media'
    || ![payload.userId, payload.workspaceId, payload.membershipId, payload.sessionId].every(v => typeof v === 'string' && v.length > 0)) {
    throw new Error('A workspace media token is required')
  }
  return payload as WorkspaceMediaTokenPayload
}

export interface WorkspaceReviewMediaTokenPayload {
  tokenUse: 'workspace-review-media'
  userId: string
  workspaceId: string
  membershipId: string
  product: string
  sessionId: string
  recordingId: string
}

/**
 * Owner/Admin review playback ticket for `<audio src>`. It names one recording of one
 * organization activity; the reviewer's role and membership are rechecked on every range request.
 */
export function signWorkspaceReviewMediaToken(input: Omit<WorkspaceReviewMediaTokenPayload, 'tokenUse'>): string {
  return jwt.sign({ ...input, tokenUse: 'workspace-review-media' }, JWT_SECRET, {
    expiresIn: '1h', audience: 'workspace-review-media', issuer: 'spashtai-workspace',
  })
}

export function verifyWorkspaceReviewMediaToken(token: string): WorkspaceReviewMediaTokenPayload {
  const payload = jwt.verify(token, JWT_SECRET, { audience: 'workspace-review-media', issuer: 'spashtai-workspace' })
  if (typeof payload === 'string' || payload.tokenUse !== 'workspace-review-media'
    || ![payload.userId, payload.workspaceId, payload.membershipId, payload.product, payload.sessionId, payload.recordingId]
      .every(v => typeof v === 'string' && v.length > 0)) {
    throw new Error('A workspace review media token is required')
  }
  return payload as WorkspaceReviewMediaTokenPayload
}
