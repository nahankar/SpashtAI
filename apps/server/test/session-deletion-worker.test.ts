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
      deleteMany: vi.fn(),
    },
    sessionRecording: { findMany: vi.fn() },
    progressPulse: { deleteMany: vi.fn() },
  },
}))
let claimedLeaseId = ''

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
    claimedLeaseId = ''
    mocks.stopSessionEgress.mockResolvedValue({
      paths: new Set(['/out/live.webm']),
      skippedUnavailable: false,
    })
    mocks.deleteRoom.mockResolvedValue(undefined)
    mocks.prisma.sessionRecording.findMany.mockResolvedValue([
      {
        egressId: 'client-segment-late',
        filePath: '/audio/late.webm',
        status: 'completed',
      },
    ])
    mocks.prisma.session.update.mockResolvedValue({})
    mocks.prisma.session.updateMany.mockImplementation(async (args: any) => {
      if (typeof args?.data?.deletionLeaseId === 'string') {
        claimedLeaseId = args.data.deletionLeaseId
      }
      return { count: 1 }
    })
    mocks.prisma.session.delete.mockResolvedValue({})
    mocks.prisma.session.deleteMany.mockResolvedValue({ count: 1 })
    mocks.prisma.progressPulse.deleteMany.mockResolvedValue({ count: 0 })
    mocks.prisma.$transaction.mockImplementation(async (operations: any[]) =>
      Promise.all(operations),
    )
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('hard-deletes only after recording storage is gone', async () => {
    mocks.prisma.session.findUnique.mockImplementation(async () => ({
      id: 'session-1',
      discardedAt: new Date(),
      deletionAttempts: 1,
      deletionLeaseId: claimedLeaseId,
      segments: [{ roomName: 'room-closed' }, { roomName: 'room-open' }],
      recordings: [{
        egressId: 'client-segment-1',
        filePath: '/audio/first.webm',
        status: 'completed',
      }],
    }))
    mocks.deleteSessionStorage.mockResolvedValue(undefined)
    const { processSessionDeletion } = await import('../src/lib/sessionDeletionWorker')

    await expect(processSessionDeletion('session-1')).resolves.toBe(true)

    expect(mocks.stopSessionEgress).toHaveBeenCalledWith(
      ['room-closed', 'room-open'],
      expect.any(Array),
    )
    expect(mocks.deleteSessionStorage).toHaveBeenCalledWith(
      'session-1',
      expect.any(Set),
    )
    expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'session-1', deletionLeaseId: claimedLeaseId }),
      }),
    )
    expect(mocks.deleteSessionStorage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.session.deleteMany.mock.invocationCallOrder[0],
    )
  })

  it('keeps the tombstone and schedules retry after cleanup failure', async () => {
    mocks.prisma.session.findUnique.mockImplementation(async () => ({
      id: 'session-2',
      discardedAt: new Date(),
      deletionAttempts: 2,
      deletionLeaseId: claimedLeaseId,
      segments: [],
      recordings: [{
        egressId: 'client-segment-2',
        filePath: 's3://bucket/session-2.webm',
        status: 'completed',
      }],
    }))
    mocks.deleteSessionStorage.mockRejectedValue(new Error('storage offline'))
    const { processSessionDeletion } = await import('../src/lib/sessionDeletionWorker')

    await expect(processSessionDeletion('session-2')).resolves.toBe(false)

    expect(mocks.prisma.session.deleteMany).not.toHaveBeenCalled()
    expect(mocks.prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'session-2',
          discardedAt: { not: null },
          deletionLeaseId: claimedLeaseId,
        }),
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
        where: expect.objectContaining({ discardedAt: { not: null } }),
      }),
    )
    expect(vi.getTimerCount()).toBeGreaterThan(0)
  })

  it('does no cleanup when another worker owns the durable lease', async () => {
    mocks.prisma.session.updateMany.mockResolvedValueOnce({ count: 0 })
    const { processSessionDeletion } = await import('../src/lib/sessionDeletionWorker')

    await expect(processSessionDeletion('session-claimed')).resolves.toBe(false)

    expect(mocks.prisma.session.findUnique).not.toHaveBeenCalled()
    expect(mocks.stopSessionEgress).not.toHaveBeenCalled()
    expect(mocks.deleteSessionStorage).not.toHaveBeenCalled()
  })

  it('retains the tombstone when a live room cannot be closed', async () => {
    mocks.prisma.session.findUnique.mockImplementation(async () => ({
      id: 'session-room-failure',
      discardedAt: new Date(),
      deletionAttempts: 1,
      deletionLeaseId: claimedLeaseId,
      segments: [{ roomName: 'room-still-live' }],
      recordings: [],
      transcript: null,
    }))
    mocks.deleteRoom.mockRejectedValue(new Error('LiveKit control plane unavailable'))
    const { processSessionDeletion } = await import('../src/lib/sessionDeletionWorker')

    await expect(processSessionDeletion('session-room-failure')).resolves.toBe(false)

    expect(mocks.deleteSessionStorage).not.toHaveBeenCalled()
    expect(mocks.prisma.session.deleteMany).not.toHaveBeenCalled()
    expect(mocks.prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deletionStatus: 'failed',
          deletionLeaseId: null,
          nextDeletionAttemptAt: expect.any(Date),
        }),
      }),
    )
  })
})
