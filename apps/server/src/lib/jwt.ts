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

export function verifyWorkspaceToken(token: string): WorkspaceTokenPayload {
  const payload = jwt.verify(token, JWT_SECRET, { audience: 'workspace-api', issuer: 'spashtai-workspace' })
  if (typeof payload === 'string' || payload.tokenUse !== 'workspace'
    || ![payload.userId, payload.workspaceId, payload.membershipId].every(v => typeof v === 'string' && v.length > 0)) {
    throw new Error('A workspace token is required')
  }
  return payload as WorkspaceTokenPayload
}
