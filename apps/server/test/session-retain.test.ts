import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    session: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  }
  return {
    tx,
    prisma: { $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) },
  }
})

vi.mock('../src/lib/prisma', () => ({ prisma: mocks.prisma }))

import { retainSession } from '../src/routes/sessions'

function response() {
  const res: any = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

const request = (body: unknown, userId = 'u1') =>
  ({ params: { id: 's1' }, body, user: { userId, role: 'USER' }, headers: {}, log: undefined }) as any

describe('retain an in-progress session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.$transaction.mockImplementation(async (fn) => fn(mocks.tx))
    mocks.tx.$queryRaw.mockResolvedValue([{ discardedAt: null }])
    mocks.tx.session.findUnique.mockResolvedValue({ userId: 'u1', endedAt: null })
    mocks.tx.session.findMany.mockResolvedValue([])
    mocks.tx.session.update.mockImplementation(async ({ data }) => ({ id: 's1', retainedAt: data.retainedAt }))
  })

  it('rejects a non-boolean retain value', async () => {
    const res = response()
    await retainSession(request({ retain: 'yes' }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('retains one session and releases the previously retained one', async () => {
    mocks.tx.session.findMany.mockResolvedValue([{ id: 'old' }])
    const res = response()
    await retainSession(request({ retain: true }), res)
    expect(mocks.tx.session.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', retainedAt: { not: null }, id: { not: 's1' }, preparationPractice: { is: null } },
    }))
    expect(mocks.tx.session.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['old'] } }, data: { retainedAt: null } })
    expect(mocks.tx.session.update.mock.calls[0][0].data.retainedAt).toBeInstanceOf(Date)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', releasedSessionIds: ['old'] }))
  })

  it('keeps interview practice retain separate from Elevate retain', async () => {
    mocks.tx.session.findUnique.mockResolvedValue({ userId: 'u1', endedAt: null, preparationPractice: { id: 'p1' } })
    await retainSession(request({ retain: true }), response())
    expect(mocks.tx.session.findMany.mock.calls[0][0].where.preparationPractice).toEqual({ isNot: null })
  })

  it('releases without touching other sessions', async () => {
    const res = response()
    await retainSession(request({ retain: false }), res)
    expect(mocks.tx.session.findMany).not.toHaveBeenCalled()
    expect(mocks.tx.session.update.mock.calls[0][0].data).toEqual({ retainedAt: null })
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retainedAt: null }))
  })

  it('refuses completed sessions and other users', async () => {
    mocks.tx.session.findUnique.mockResolvedValueOnce({ userId: 'u1', endedAt: new Date() })
    let res = response()
    await retainSession(request({ retain: true }), res)
    expect(res.status).toHaveBeenCalledWith(409)

    res = response()
    await retainSession(request({ retain: true }, 'admin'), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(mocks.tx.session.update).not.toHaveBeenCalled()
  })
})
