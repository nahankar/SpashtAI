import { OAuth2Client } from 'google-auth-library'

export interface GoogleUserInfo {
  googleId: string
  email: string
  emailVerified: boolean
  firstName: string | null
  lastName: string | null
  avatar: string | null
}

export async function verifyGoogleIdToken(credential: string): Promise<GoogleUserInfo> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  if (!clientId) {
    throw new Error('Google sign-in is not configured')
  }

  const client = new OAuth2Client(clientId)
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: clientId,
  })

  const payload = ticket.getPayload()
  if (!payload?.email || !payload.sub) {
    throw new Error('Invalid Google token')
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: Boolean(payload.email_verified),
    firstName: payload.given_name ?? null,
    lastName: payload.family_name ?? null,
    avatar: payload.picture ?? null,
  }
}
