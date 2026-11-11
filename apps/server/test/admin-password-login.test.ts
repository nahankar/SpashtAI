import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { hashPassword } from '../src/lib/password'
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), activity: vi.fn(), settings: vi.fn() }))
vi.mock('../src/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUnique, update: mocks.update }, userActivity: { create: mocks.activity } } }))
vi.mock('../src/lib/email', () => ({ sendEmail: vi.fn(), buildPasswordResetEmail: vi.fn() }))
vi.mock('../src/lib/google-auth', () => ({ verifyGoogleIdToken: vi.fn() }))
vi.mock('../src/lib/platformSettings', () => ({ getPlatformSettings: mocks.settings, areSignupsPaused: async () => true, getSignupsPausedMessage: async () => 'Paused', areRewardPointsEnabled: async () => false }))
vi.mock('../src/middleware/rate-limit', () => ({ authLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }))
import authRouter from '../src/routes/auth'
import { verifyToken } from '../src/lib/jwt'
const app = express(); app.use(express.json()); app.use('/api/auth', authRouter)
const originalNodeEnv = process.env.NODE_ENV
const password = 'test-only-password'; let passwordHash: string
const account = (role = 'ADMIN') => ({ id: 'staff', email: 'admin@example.invalid', firstName: 'Admin', lastName: null, avatar: null, role, emailVerified: true, passwordHash })
const login = (body: unknown = { email: 'admin@example.invalid', password }) => request(app).post('/api/auth/login').send(body)
beforeAll(async () => { passwordHash = await hashPassword(password) })
beforeEach(() => {
  process.env.NODE_ENV = 'production'; vi.clearAllMocks()
  mocks.findUnique.mockResolvedValue(account()); mocks.update.mockResolvedValue(account()); mocks.activity.mockResolvedValue({})
  mocks.settings.mockRejectedValue(new Error('Admin password login must not load provider settings'))
})
afterAll(() => { process.env.NODE_ENV = originalNodeEnv })
describe('dedicated production Admin password login', () => {
  it.each(['ADMIN', 'SUPER_ADMIN'])('authenticates %s independently of provider switches and signup pause', async role => {
    mocks.findUnique.mockResolvedValue(account(role))
    const result = await login()
    expect(result.status, result.text).toBe(200); expect(result.body.user.role).toBe(role)
    expect(verifyToken(result.body.token)).toMatchObject({ userId: 'staff', role })
    expect(mocks.settings).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledOnce(); expect(mocks.activity).toHaveBeenCalledOnce()
    expect(result.body.user.passwordHash).toBeUndefined()
  })
  it('keeps ordinary users, including tenant Owners/Admins with global USER role, on enabled provider sign-in', async () => {
    mocks.findUnique.mockResolvedValue({ ...account('USER'), tenantOnly: true })
    expect((await login()).status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.activity).not.toHaveBeenCalled()
  })
  it('rejects incorrect passwords without issuing a token or updating login history', async () => {
    const result = await login({ email: 'admin@example.invalid', password: 'wrong-test-password' })
    expect(result.status).toBe(401); expect(result.body.token).toBeUndefined()
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.activity).not.toHaveBeenCalled()
  })
  it('rejects missing accounts, missing passwords and accounts without a password', async () => {
    mocks.findUnique.mockResolvedValueOnce(null)
    expect((await login()).status).toBe(401)
    expect((await login({ email: 'admin@example.invalid' })).status).toBe(400)
    mocks.findUnique.mockResolvedValueOnce({ ...account(), passwordHash: null })
    expect((await login()).status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
