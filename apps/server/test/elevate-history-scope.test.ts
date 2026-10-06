import { beforeEach, describe, expect, it, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  session: { findMany: vi.fn() },
  progressPulse: { findMany: vi.fn() },
}))

vi.mock('../src/lib/prisma', () => ({ prisma }))

import { listSessions } from '../src/routes/sessions'

function response() {
  const res: any = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

describe('standalone Elevate history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.session.findMany.mockResolvedValue([])
  })

  it.each([
    ['USER', { userId: 'u1', discardedAt: null, purpose: 'COMMUNICATION', preparationPractice: null }],
    ['ADMIN', { discardedAt: null, purpose: 'COMMUNICATION', preparationPractice: null }],
    ['SUPER_ADMIN', { discardedAt: null, purpose: 'COMMUNICATION', preparationPractice: null }],
  ])('excludes Prepare interview practices for %s', async (role, where) => {
    prisma.user.findUnique.mockResolvedValue({ role })
    await listSessions({ user: { userId: 'u1', role }, query: {} } as any, response())
    expect(prisma.session.findMany.mock.calls[0][0].where).toEqual(where)
  })

  it('keeps an admin personal picker owner-scoped', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' })
    await listSessions({ user: { userId: 'u1', role: 'ADMIN' }, query: { scope: 'mine' } } as any, response())
    expect(prisma.session.findMany.mock.calls[0][0].where).toEqual({
      userId: 'u1', discardedAt: null, purpose: 'COMMUNICATION', preparationPractice: null,
    })
  })
})
