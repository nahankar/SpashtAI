import { randomUUID } from 'crypto'
import express from 'express'
import request from 'supertest'
import { afterAll, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => {
  const url = process.env.BANK_TEST_DATABASE_URL
  if (url && url !== 'postgresql://postgres@127.0.0.1:55441/simple_bank') throw new Error('Signup integration tests require the isolated simple_bank database')
  return { url }
})
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: db.url || 'postgresql://postgres@127.0.0.1:55441/simple_bank' }) }
})
const google = vi.hoisted(() => ({ verify: vi.fn() }))
vi.mock('../src/lib/google-auth', () => ({ verifyGoogleIdToken: google.verify }))
vi.mock('../src/middleware/rate-limit', () => ({ authLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }))
vi.mock('../src/lib/email', () => ({ sendEmail: vi.fn(), buildPasswordResetEmail: vi.fn() }))
vi.mock('../src/lib/platformSettings', async original => ({ ...await original<object>(), areSignupsPaused: async () => false }))
vi.mock('../src/lib/pincode', async original => ({ ...await original<object>(), resolvePincodeLocation: async () => ({ city: null, state: null, country: null }) }))
import { prisma } from '../src/lib/prisma'
import authRouter from '../src/routes/auth'
import { recordingAcknowledgment } from '../src/interviews/practice/service'

const app = express(); app.use(express.json()); app.use('/auth', authRouter)
const tag = `ack-signup-${randomUUID().slice(0, 8)}`
const created: string[] = []
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } })
  await prisma.$disconnect()
})

describe.skipIf(!db.url)('recording acknowledgment across signup paths', () => {
  it('is never created or inferred by email signup or Google signup', async () => {
    const email = await request(app).post('/auth/register').send({ email: `${tag}-email@example.invalid`, password: 'Test-password-1', firstName: 'Ack', lastName: 'Email',
      phone: '9876543210', dateOfBirth: '1990-01-01', gender: 'FEMALE', pincode: '411001', acceptedTerms: true })
    google.verify.mockResolvedValue({ googleId: `${tag}-g`, email: `${tag}-google@example.invalid`, emailVerified: true, firstName: 'Ack', lastName: 'Google', avatar: null })
    const viaGoogle = await request(app).post('/auth/google').send({ credential: 'test-credential' })
    expect(email.body.error, 'email signup').toBeUndefined()
    const users = await prisma.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true, email: true } })
    created.push(...users.map(u => u.id))
    expect([email.status, viaGoogle.status].every(s => s < 300) ? users.length : -1).toBe(2)
    for (const user of users) {
      expect(await prisma.recordingAcknowledgment.count({ where: { userId: user.id } })).toBe(0)
      expect((await recordingAcknowledgment(user.id)).accepted).toBeNull()
    }
  })
})
