import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteRoom: vi.fn(),
  stopSessionEgress: vi.fn(),
  deleteSessionStorage: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    session: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    sessionRecording: { findMany: vi.fn() },
    progressPulse: { deleteMany: vi.fn() },
  },
}))

vi.mock('../src/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('../src/lib/sessionStorageCleanup', () => ({
  stopSessionEgress: mocks.stopSessionEgress,
  deleteSessionStorage: mocks.deleteSessionStorage,
}))
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {
    deleteRoom = mocks.deleteRoom
  },
}))

describe('durable discarded-session cleanup worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    process.env.LIVEKIT_URL = 'ws://localhost:7880'
    process.env.LIVEKIT_API_KEY = 'key'
    process.env.LIVEKIT_API_SECRET = 'secret'
    mocks.stopSessionEgress.mockResolvedValue(new Set(['/out/live.webm']))
    mocks.deleteRoom.mockResolvedValue(undefined)
    mocks.prisma.sessionRecording.findMany.mockResolvedValue([
      { filePath: '/audio/late.webm' },
    ])
    mocks.prisma.session.update.mockResolvedValue({})
    mocks.prisma.session.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.session.delete.mockResolvedValue({})
    mocks.prisma.progressPulse.deleteMany.mockResolvedValue({ count: 0 })
    mocks.prisma.$transaction.mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('hard-deletes only after recording storage is gone', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      discardedAt: new Date(),
      deletionAttempts: 0,
      segments: [{ roomName: 'room-1' }],
      recordings: [{ filePath: '/audio/first.webm' }],
    })
    mocks.deleteSessionStorage.mockResolvedValue(undefined)
    const { processSessionDeletion } = await import('../src/lib/sessionDeletionWorker')

    await expect(processSessionDeletion('session-1')).resolves.toBe(true)

    expect(mocks.deleteSessionStorage).toHaveBeenCalledWith(
      'session-1',
      expect.any(Set),
    )
    expect(mocks.prisma.session.delete).toHaveBeenCalledWith({
      where: { id: 'session-1' },
    })
    expect(mocks.deleteSessionStorage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.session.delete.mock.invocationCallOrder[0],
    )
  })

  it('keeps the tombstone and schedules retry after cleanup failure', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: 'session-2',
      discardedAt: new Date(),
      deletionAttempts: 1,
      segments: [],
      recordings: [{ filePath: 's3://bucket/session-2.webm' }],
    })
    mocks.deleteSessionStorage.mockRejectedValue(new Error('storage offline'))
    const { processSessionDeletion } = await import('../src/lib/sessionDeletionWorker')

    await expect(processSessionDeletion('session-2')).resolves.toBe(false)

    expect(mocks.prisma.session.delete).not.toHaveBeenCalled()
    expect(mocks.prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-2', discardedAt: { not: null } },
        data: expect.objectContaining({
          deletionStatus: 'failed',
          deletionError: 'storage offline',
          nextDeletionAttemptAt: expect.any(Date),
        }),
      }),
    )
    expect(vi.getTimerCount()).toBeGreaterThan(0)
  })

  it('re-enqueues persisted tombstones after a process restart', async () => {
    mocks.prisma.session.findMany.mockResolvedValue([
      { id: 'session-restart', nextDeletionAttemptAt: null },
    ])
    const { sweepPendingDeletions } = await import('../src/lib/sessionDeletionWorker')

    await sweepPendingDeletions()

    expect(mocks.prisma.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { discardedAt: { not: null } },
      }),
    )
    expect(vi.getTimerCount()).toBeGreaterThan(0)
  })
})
