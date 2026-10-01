import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    session: { findUnique: vi.fn(), update: vi.fn() },
    sessionSegment: { aggregate: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    sessionTurn: { aggregate: vi.fn() },
    sessionTranscript: { findUnique: vi.fn() },
    sessionRecording: { aggregate: vi.fn() },
  }
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
      session: { findMany: vi.fn() },
    },
    award: vi.fn(),
    queuePace: vi.fn(),
    analyze: vi.fn(),
  }
})

vi.mock('../src/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('../src/lib/points', () => ({ awardSessionActivePoints: mocks.award }))
vi.mock('../src/lib/paceReconciliationWorker', () => ({
  queuePaceReconciliation: mocks.queuePace,
  requeuePaceReconciliationData: () => ({ paceReconciliationStatus: 'pending' }),
}))

vi.mock('../src/routes/analytics', () => ({ runSessionAnalysis: mocks.analyze }))

import {
  analyzeCompletedSession,
  completeInactiveSession,
  latestActivityAt,
  sweepInactiveSessions,
} from '../src/lib/sessionInactivityWorker'

const NOW = new Date('2026-10-01T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

function stubActivity({
  started = hoursAgo(30),
  segmentUpdated = null as Date | null,
  turn = null as Date | null,
  endedAt = null as Date | null,
  openSegments = [] as Array<{ id: string; startedAt: Date; audioStatus: string; recording: { id: string } | null }>,
  segmentCount = 0,
  closedSum = 0,
  prepare = false,
  module = 'elevate',
} = {}) {
  const { tx } = mocks
  tx.$queryRaw.mockResolvedValue([{ discardedAt: null }])
  tx.session.findUnique.mockResolvedValue({
    id: 's1', userId: 'u1', startedAt: started, endedAt, durationSec: null, module,
    preparationPractice: prepare ? { id: 'p1' } : null,
  })
  tx.sessionSegment.aggregate.mockImplementation(async (args: { _sum?: unknown }) =>
    args._sum
      ? { _sum: { activeDurationSec: closedSum } }
      : { _max: { startedAt: null, endedAt: null, updatedAt: segmentUpdated } },
  )
  tx.sessionTurn.aggregate.mockResolvedValue({ _max: { createdAt: turn } })
  tx.sessionTranscript.findUnique.mockResolvedValue(null)
  tx.sessionRecording.aggregate.mockResolvedValue({ _max: { updatedAt: null } })
  tx.sessionSegment.findMany.mockResolvedValue(openSegments)
  tx.sessionSegment.count.mockResolvedValue(segmentCount)
}

describe('session inactivity worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.$transaction.mockImplementation(async (fn) => fn(mocks.tx))
    mocks.analyze.mockResolvedValue({ status: 200, body: {} })
  })

  it('picks the latest activity timestamp', () => {
    expect(latestActivityAt(hoursAgo(10), [null, hoursAgo(5), hoursAgo(8)])).toEqual(hoursAgo(5))
    expect(latestActivityAt(hoursAgo(10), [])).toEqual(hoursAgo(10))
  })

  it('does not complete a session with activity inside the last 24 hours', async () => {
    stubActivity({ started: hoursAgo(48), turn: hoursAgo(2) })
    expect(await completeInactiveSession('s1', NOW)).toEqual({ completed: false, reason: 'active' })
    expect(mocks.tx.session.update).not.toHaveBeenCalled()
  })

  it('leaves already-ended sessions untouched', async () => {
    stubActivity({ endedAt: hoursAgo(25) })
    expect(await completeInactiveSession('s1', NOW)).toEqual({ completed: false, reason: 'already_ended' })
    expect(mocks.tx.session.update).not.toHaveBeenCalled()
  })

  it('skips discarded sessions', async () => {
    stubActivity()
    mocks.tx.$queryRaw.mockResolvedValue([{ discardedAt: hoursAgo(1) }])
    expect(await completeInactiveSession('s1', NOW)).toEqual({ completed: false, reason: 'discarded' })
  })

  it('ends at the last activity, closes open segments, and queues post-session analysis', async () => {
    const segmentStart = hoursAgo(29.5)
    stubActivity({
      started: hoursAgo(30),
      turn: hoursAgo(29),
      openSegments: [{ id: 'seg1', startedAt: segmentStart, audioStatus: 'pending', recording: null }],
      segmentCount: 1,
      closedSum: 1800,
    })
    const result = await completeInactiveSession('s1', NOW)
    expect(result).toMatchObject({ completed: true, endedAt: hoursAgo(29), userId: 'u1' })
    expect(mocks.tx.sessionSegment.update).toHaveBeenCalledWith({
      where: { id: 'seg1' },
      data: { endedAt: hoursAgo(29), activeDurationSec: 1800, audioStatus: 'unavailable' },
    })
    expect(mocks.tx.session.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: expect.objectContaining({
        endedAt: hoursAgo(29),
        durationSec: 1800,
        paceReconciliationStatus: 'pending',
        deliveryAlignmentStatus: 'pending',
      }),
    })
  })

  it('marks a pending segment with an uploaded recording as available', async () => {
    stubActivity({
      openSegments: [{ id: 'seg1', startedAt: hoursAgo(30), audioStatus: 'pending', recording: { id: 'r1' } }],
      segmentCount: 1,
    })
    await completeInactiveSession('s1', NOW)
    expect(mocks.tx.sessionSegment.update.mock.calls[0][0].data.audioStatus).toBe('available')
  })

  it('sweeps stale candidates, awards standalone points, and skips Prepare points', async () => {
    mocks.prisma.session.findMany.mockResolvedValueOnce([{ id: 's1' }])
    stubActivity({ prepare: false })
    expect(await sweepInactiveSessions(NOW)).toBe(1)
    expect(mocks.prisma.session.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { endedAt: null, discardedAt: null, startedAt: { lt: hoursAgo(24) } },
    }))
    expect(mocks.queuePace).toHaveBeenCalledWith('s1')
    expect(mocks.award).toHaveBeenCalledWith('u1', 's1')
    expect(mocks.analyze).toHaveBeenCalledWith('s1', { source: 'elevate' })

    vi.clearAllMocks()
    mocks.prisma.$transaction.mockImplementation(async (fn) => fn(mocks.tx))
    mocks.prisma.session.findMany.mockResolvedValueOnce([{ id: 's1' }])
    stubActivity({ prepare: true })
    expect(await sweepInactiveSessions(NOW)).toBe(1)
    expect(mocks.award).not.toHaveBeenCalled()
    expect(mocks.analyze).toHaveBeenCalledWith('s1', { source: 'elevate' })
  })

  it('runs the Leave analysis only for Elevate sessions', async () => {
    mocks.analyze.mockResolvedValue({ status: 200, body: {} })
    mocks.prisma.session.findMany.mockResolvedValueOnce([{ id: 's1' }])
    stubActivity({ module: 'pitch' })
    expect(await sweepInactiveSessions(NOW)).toBe(1)
    expect(mocks.analyze).not.toHaveBeenCalled()
  })

  it('reports analysis failures without throwing', async () => {
    mocks.analyze.mockResolvedValueOnce({ status: 400, body: { error: 'Transcript has no messages' } })
    expect(await analyzeCompletedSession('s1')).toBe(false)
    mocks.analyze.mockRejectedValueOnce(new Error('bedrock down'))
    expect(await analyzeCompletedSession('s1')).toBe(false)
    mocks.analyze.mockResolvedValueOnce({ status: 200, body: {} })
    expect(await analyzeCompletedSession('s1')).toBe(true)
  })

  it('continues the sweep when one session fails', async () => {
    mocks.prisma.session.findMany.mockResolvedValueOnce([{ id: 'bad' }, { id: 's1' }])
    stubActivity()
    mocks.prisma.$transaction
      .mockRejectedValueOnce(new Error('db blip'))
      .mockImplementation(async (fn) => fn(mocks.tx))
    expect(await sweepInactiveSessions(NOW)).toBe(1)
  })
})
