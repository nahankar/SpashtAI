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
  return jwt.verify(token, JWT_SECRET) as TokenPayload
}
