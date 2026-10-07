import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('../src/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }))
import { requireSuperAdmin } from '../src/middleware/admin'
function context(role = 'SUPER_ADMIN', userId: string | undefined = 'publisher') {
  const req = { user: userId ? { userId, role } : undefined, query: { scope: 'mine' } } as unknown as Request
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
  return { req, res, next: vi.fn() }
}
beforeEach(() => vi.resetAllMocks())
describe('current database publication role', () => {
  it.each(['ADMIN', 'USER', null])('rejects a stale Super Admin token when the current role is %s', async role => {
    mocks.findUnique.mockResolvedValue(role ? { role } : null)
    const c = context(); await requireSuperAdmin(c.req, c.res, c.next)
    expect(c.res.status).toHaveBeenCalledWith(403); expect(c.next).not.toHaveBeenCalled()
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: 'publisher' }, select: { role: true } })
  })
  it('permits a current Super Admin independently of the token snapshot and list scope', async () => {
    mocks.findUnique.mockResolvedValue({ role: 'SUPER_ADMIN' })
    const c = context('ADMIN'); await requireSuperAdmin(c.req, c.res, c.next)
    expect(c.next).toHaveBeenCalledWith(); expect(c.res.status).not.toHaveBeenCalled()
  })
  it('rejects missing identity without querying for a user', async () => {
    const c = context('SUPER_ADMIN', ''); await requireSuperAdmin(c.req, c.res, c.next)
    expect(c.res.status).toHaveBeenCalledWith(403); expect(mocks.findUnique).not.toHaveBeenCalled()
  })
  it('propagates database failure without granting access', async () => {
    const error = new Error('Database unavailable'); mocks.findUnique.mockRejectedValue(error)
    const c = context(); await requireSuperAdmin(c.req, c.res, c.next)
    expect(c.next).toHaveBeenCalledExactlyOnceWith(error)
  })
})
