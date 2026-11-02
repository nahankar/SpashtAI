import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { randomUUID } from 'crypto'
const testDb = vi.hoisted(() => {
  const url = process.env.WORKSPACE_TEST_DATABASE_URL || process.env.BANK_TEST_DATABASE_URL
  if (url && !['postgresql://postgres@127.0.0.1:55441/simple_bank', 'postgresql://postgres@127.0.0.1:55443/postgres'].includes(url)) throw new Error('Invitation tests use only the isolated simple_bank database')
  return { url }
})
// One pooled connection: any second connection acquisition inside an interactive transaction would wait for the
// transaction's own connection and time out.
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  const base = testDb.url || 'postgresql://postgres@127.0.0.1:55441/simple_bank'
  return { prisma: new PrismaClient({ datasourceUrl: `${base}?connection_limit=1&pool_timeout=2` }) }
})
vi.mock('../src/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('../src/lib/google-auth', () => ({
  verifyGoogleIdToken: async (credential: string) => {
    const g = JSON.parse(credential)
    return { googleId: g.sub, email: g.email, emailVerified: true, firstName: null, lastName: null, avatar: null }
  },
}))
import { prisma } from '../src/lib/prisma'
import { signInWithGoogleUser } from '../src/lib/googleSignIn'
import { capturedInvitationEmails, createInvitation } from '../src/lib/invitations'
import invitationsRouter from '../src/routes/invitations'

const app = express(); app.use(express.json()); app.use('/api/invitations', invitationsRouter)
const tag = `pool_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const addr = (name: string) => `${tag}_${name}@example.invalid`
const identity = (email: string) => ({ googleId: `g-${email}`, email, emailVerified: true, firstName: null, lastName: null, avatar: null })
const req = { ip: '127.0.0.1', headers: {} } as unknown as express.Request
let adminId: string

describe.skipIf(!testDb.url)('Google sign-in and invitation acceptance with a one-connection pool', () => {
  beforeAll(async () => { adminId = (await prisma.user.create({ data: { email: addr('admin'), role: 'ADMIN' } })).id })
  afterAll(async () => {
    await prisma.userInvitation.deleteMany({ where: { email: { startsWith: tag } } })
    await prisma.adminAction.deleteMany({ where: { adminId } })
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } })
    await prisma.$disconnect()
  })

  it('control: a global-client query nested in a transaction cannot get a connection', async () => {
    await expect(prisma.$transaction(async () => { await prisma.platformSettings.findFirst() })).rejects.toThrow()
  })

  it('completes concurrent new signups, same-address signups and an acceptance without nested acquisition', async () => {
    const invited = addr('invited')
    await createInvitation(adminId, { email: invited })
    const mail = capturedInvitationEmails().find((m) => m.to === invited)!
    const token = new URL(mail.acceptUrl).hash.replace('#token=', '')
    const results = await Promise.all([
      signInWithGoogleUser(identity(addr('a')), req),
      signInWithGoogleUser(identity(addr('b')), req),
      signInWithGoogleUser(identity(addr('same')), req),
      signInWithGoogleUser(identity(addr('same')), req),
      request(app).post('/api/invitations/accept').send({ token, credential: JSON.stringify({ sub: `g-${invited}`, email: invited }) }),
      signInWithGoogleUser(identity(invited), req),
    ])
    expect(results.slice(0, 4).every((r) => 'ok' in r && r.ok)).toBe(true)
    expect((results[4] as request.Response).status).toBe(200)
    expect(results[5]).toMatchObject({ ok: true })
    for (const name of ['a', 'b', 'same', 'invited']) expect(await prisma.user.count({ where: { email: addr(name) } })).toBe(1)
    expect(await prisma.userInvitation.findFirst({ where: { email: invited } })).toMatchObject({ status: 'ACCEPTED' })
  })
})
