import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { hashPassword } from '../src/lib/password'
import { developmentLoginEnabled, isWalkthroughAccount } from '../src/lib/devLogin'

const user = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}))
vi.mock('../src/lib/prisma', () => ({ prisma: { user, userActivity: { create: vi.fn() } } }))
vi.mock('../src/lib/email', () => ({ sendEmail: vi.fn(), buildPasswordResetEmail: vi.fn() }))
vi.mock('../src/lib/google-auth', () => ({ verifyGoogleIdToken: vi.fn() }))
vi.mock('../src/lib/googleSignIn', () => ({ signInWithGoogleUser: vi.fn() }))
vi.mock('../src/lib/platformSettings', () => ({
  getPlatformSettings: async () => ({ googleSignInEnabled: true, emailCodeSignInEnabled: true }),
  areSignupsPaused: async () => false,
  getSignupsPausedMessage: async () => '',
  areRewardPointsEnabled: async () => false,
}))
vi.mock('../src/middleware/rate-limit', () => ({ authLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }))

const env = { node: process.env.NODE_ENV, login: process.env.DEV_LOGIN }
afterEach(() => {
  process.env.NODE_ENV = env.node
  if (env.login === undefined) delete process.env.DEV_LOGIN
  else process.env.DEV_LOGIN = env.login
  vi.clearAllMocks()
})

describe('development login gate', () => {
  it('never opens in production, even when the switch is on', () => {
    process.env.NODE_ENV = 'production'
    process.env.DEV_LOGIN = 'true'
    expect(developmentLoginEnabled()).toBe(false)
  })

  it('stays closed in development until the switch is set', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.DEV_LOGIN
    expect(developmentLoginEnabled()).toBe(false)
    process.env.DEV_LOGIN = 'true'
    expect(developmentLoginEnabled()).toBe(true)
  })

  it('accepts only fictional walkthrough addresses', () => {
    expect(isWalkthroughAccount('learner@walkthrough.test')).toBe(true)
    expect(isWalkthroughAccount('admin@spasht.ai')).toBe(false)
    expect(isWalkthroughAccount('someone@example.com')).toBe(false)
  })
})

describe('POST /api/auth/dev-login', () => {
  async function app() {
    process.env.JWT_SECRET = 'walkthrough-test-secret'
    vi.resetModules()
    const { default: authRouter } = await import('../src/routes/auth')
    const server = express()
    server.use(express.json())
    server.use('/api/auth', authRouter)
    return server
  }

  it('is closed in production even if called directly', async () => {
    process.env.NODE_ENV = 'production'
    process.env.DEV_LOGIN = 'true'
    const res = await request(await app()).post('/api/auth/dev-login').send({ email: 'learner@walkthrough.test', password: 'x' })
    expect([res.status, res.body.code]).toEqual([404, 'DEV_LOGIN_DISABLED'])
    expect(user.findUnique).not.toHaveBeenCalled()
  })

  it('rejects addresses outside the fictional walkthrough set', async () => {
    process.env.NODE_ENV = 'development'
    process.env.DEV_LOGIN = 'true'
    const res = await request(await app()).post('/api/auth/dev-login').send({ email: 'admin@spasht.ai', password: 'nimda' })
    expect([res.status, res.body.code]).toEqual([401, 'DEV_LOGIN_REJECTED'])
    expect(user.findUnique).not.toHaveBeenCalled()
  })

  it('signs in an existing walkthrough account only', async () => {
    process.env.NODE_ENV = 'development'
    process.env.DEV_LOGIN = 'true'
    const passwordHash = await hashPassword('Walkthrough-Local-1')
    const row = { id: 'u1', email: 'learner@walkthrough.test', role: 'USER', passwordHash, firstName: 'LEARNER', lastName: 'One' }
    user.findUnique.mockResolvedValue(row)
    user.update.mockResolvedValue(row)
    const res = await request(await app()).post('/api/auth/dev-login').send({ email: 'learner@walkthrough.test', password: 'Walkthrough-Local-1' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
    expect(res.body.user.email).toBe('learner@walkthrough.test')
  })
})
