import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  sessionMetrics: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
}))

const resolveMock = vi.hoisted(() => ({
  resolveElevateSessionAudio: vi.fn(),
  resolveElevateAudioInputSignature: vi.fn(),
}))

vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../src/analytics/insightProviders/resolveSessionAudio', () => resolveMock)
vi.mock('../src/lib/sessionDiscard', () => ({
  lockWritableSession: vi.fn(),
}))

import {
  enrichElevateSessionAudio,
  hasActiveAudioEnrichmentLease,
  scheduleElevateSessionAudioEnrichmentIfAnalyzed,
  sweepAudioEnrichmentRetries,
} from '../src/analytics/audioEnrichment'

describe('late recording enrichment', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    prismaMock.sessionMetrics.findUnique.mockReset()
    prismaMock.sessionMetrics.findMany.mockReset()
    prismaMock.sessionMetrics.findMany.mockResolvedValue([])
    prismaMock.sessionMetrics.update.mockReset()
    prismaMock.$transaction.mockReset()
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock))
    resolveMock.resolveElevateSessionAudio.mockReset()
    resolveMock.resolveElevateAudioInputSignature.mockReset()
    resolveMock.resolveElevateAudioInputSignature.mockResolvedValue('sig-1')
  })

  it('does not schedule duplicate enrichment while another worker holds a fresh lease', () => {
    expect(
      hasActiveAudioEnrichmentLease(
        {
          audioEnrichmentStatus: 'processing',
          audioEnrichmentLeaseUntil: '2026-09-23T00:01:00.000Z',
        },
        Date.parse('2026-09-23T00:00:00.000Z'),
      ),
    ).toBe(true)
    expect(
      hasActiveAudioEnrichmentLease(
        {
          audioEnrichmentStatus: 'processing',
          audioEnrichmentLeaseUntil: '2026-09-22T23:59:59.000Z',
        },
        Date.parse('2026-09-23T00:00:00.000Z'),
      ),
    ).toBe(false)
  })

  it('attaches prosody onto existing text metrics without Pulse writes', async () => {
    resolveMock.resolveElevateSessionAudio.mockResolvedValue({
      audioPath: '/tmp/session.webm',
      inputSignature: 'sig-1',
    })
    prismaMock.sessionMetrics.findUnique.mockResolvedValue({
      communicationSignals: { fillers: { rate: 0.1 } },
      processingStatus: { audioStatus: 'pending', audio_processed: false },
    })
    prismaMock.sessionMetrics.update.mockResolvedValue({})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ prosody: { pitchVariation: 6.2, voiceQuality: 7.1 } }),
      }),
    )

    await enrichElevateSessionAudio('session-late')

    expect(prismaMock.sessionMetrics.update).toHaveBeenCalledOnce()
    const payload = prismaMock.sessionMetrics.update.mock.calls[0][0].data
    expect(payload.communicationSignals.prosody.pitchVariation).toBe(6.2)
    expect(payload.processingStatus.audioStatus).toBe('available')
    expect(payload.processingStatus.audio_processed).toBe(true)
    expect(payload.processingStatus.audioInputSignature).toBe('sig-1')
  })

  it('schedules enrichment when metrics already exist for a late upload', async () => {
    resolveMock.resolveElevateSessionAudio.mockResolvedValue({
      audioPath: '/tmp/late-segment.webm',
      inputSignature: 'sig-1',
    })
    prismaMock.sessionMetrics.findUnique.mockResolvedValue({
      sessionId: 'session-uploaded-late',
      communicationSignals: {},
      processingStatus: {},
    })
    prismaMock.sessionMetrics.update.mockResolvedValue({})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ prosody: { pitchVariation: 6.8 } }),
      }),
    )

    scheduleElevateSessionAudioEnrichmentIfAnalyzed('session-uploaded-late')

    await vi.waitFor(() => {
      expect(
        prismaMock.sessionMetrics.update.mock.calls.some(
          ([call]) => call.data.communicationSignals?.prosody?.pitchVariation === 6.8,
        ),
      ).toBe(true)
    })
  })

  it('rereads status under lock so concurrent pace evidence is preserved', async () => {
    resolveMock.resolveElevateSessionAudio.mockResolvedValue({
      audioPath: '/tmp/session.webm',
      segments: [],
      inputSignature: 'sig-1',
    })
    prismaMock.sessionMetrics.findUnique
      .mockResolvedValueOnce({
        communicationSignals: { fillers: { rate: 0.1 } },
        processingStatus: { audioStatus: 'pending' },
      })
      .mockResolvedValueOnce({
        communicationSignals: { fillers: { rate: 0.1 } },
        processingStatus: {
          audioStatus: 'pending',
          pace: { status: 'available', wpm: 123 },
        },
      })
    prismaMock.sessionMetrics.update.mockResolvedValue({})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          prosody: { pitchVariation: 6.2, energyStability: 7.1, voiceQuality: 8 },
        }),
      }),
    )

    await enrichElevateSessionAudio('session-concurrent')

    const payload = prismaMock.sessionMetrics.update.mock.calls[0][0].data
    expect(payload.processingStatus.pace).toEqual({ status: 'available', wpm: 123 })
    expect(payload.processingStatus.audio_processed).toBe(true)
  })

  it('does not overwrite real prosody on a second enrichment', async () => {
    resolveMock.resolveElevateSessionAudio.mockResolvedValue({
      audioPath: '/tmp/session.webm',
      inputSignature: 'sig-1',
    })
    prismaMock.sessionMetrics.findUnique.mockResolvedValue({
      communicationSignals: { prosody: { voiceQuality: 8 } },
      processingStatus: {
        audioStatus: 'available',
        audio_processed: true,
        audioInputSignature: 'sig-1',
        audioEnrichmentStatus: 'completed',
      },
    })

    await enrichElevateSessionAudio('session-late')

    expect(prismaMock.sessionMetrics.update).not.toHaveBeenCalled()
  })

  it('replaces partial prosody when the resolved audio fingerprint changes', async () => {
    resolveMock.resolveElevateSessionAudio.mockResolvedValue({
      audioPath: '/tmp/session-two-segments.webm',
      inputSignature: 'sig-2',
    })
    resolveMock.resolveElevateAudioInputSignature.mockResolvedValue('sig-2')
    prismaMock.sessionMetrics.findUnique.mockResolvedValue({
      communicationSignals: { prosody: { pitchVariation: 2 } },
      processingStatus: {
        audioStatus: 'available',
        audio_processed: true,
        audioInputSignature: 'sig-1',
      },
    })
    prismaMock.sessionMetrics.update.mockResolvedValue({})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ prosody: { pitchVariation: 7.5 } }),
      }),
    )

    await enrichElevateSessionAudio('session-expanded-audio')

    const payload = prismaMock.sessionMetrics.update.mock.calls[0][0].data
    expect(payload.communicationSignals.prosody.pitchVariation).toBe(7.5)
    expect(payload.processingStatus.audioInputSignature).toBe('sig-2')
  })

  it('does not persist an empty prosody object as acoustic data', async () => {
    resolveMock.resolveElevateSessionAudio.mockResolvedValue({
      audioPath: '/tmp/session.webm',
      inputSignature: 'sig-2',
    })
    resolveMock.resolveElevateAudioInputSignature.mockResolvedValue('sig-2')
    prismaMock.sessionMetrics.findUnique.mockResolvedValue({
      communicationSignals: {
        fillers: { rate: 0.1 },
        prosody: { pitchVariation: 2.1 },
      },
      processingStatus: {
        audioStatus: 'available',
        audio_processed: true,
        audioInputSignature: 'sig-1',
      },
      totalTurns: 3,
    })
    prismaMock.sessionMetrics.update.mockResolvedValue({})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ prosody: {} }),
      }),
    )

    await enrichElevateSessionAudio('session-empty-prosody')

    const payload = prismaMock.sessionMetrics.update.mock.calls[0][0].data
    expect(payload.communicationSignals.prosody).toBeUndefined()
    expect(payload.processingStatus.audio_processed).toBe(false)
    expect(payload.processingStatus.audioInputSignature).toBeNull()
    expect(payload.processingStatus.audioEnrichmentStatus).toBe('retry')
    expect(payload.processingStatus.audioEnrichmentNextRetryAt).toEqual(
      expect.any(String),
    )
  })

  it.each([
    [
      'a rejected prosody request',
      vi.fn().mockRejectedValue(new Error('signal api unreachable')),
    ],
    [
      'a malformed prosody response body',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON')
        },
      }),
    ],
  ])('clears stale prosody and queues a retry after %s', async (_label, fetchImpl) => {
    resolveMock.resolveElevateSessionAudio.mockResolvedValue({
      audioPath: '/tmp/session-two-segments.webm',
      inputSignature: 'sig-2',
    })
    resolveMock.resolveElevateAudioInputSignature.mockResolvedValue('sig-2')
    prismaMock.sessionMetrics.findUnique.mockResolvedValue({
      communicationSignals: {
        fillers: { rate: 0.1 },
        prosody: { pitchVariation: 2.1 },
      },
      processingStatus: {
        audioStatus: 'available',
        audio_processed: true,
        audioInputSignature: 'sig-1',
        audioEnrichmentAttempts: 1,
      },
      totalTurns: 3,
    })
    prismaMock.sessionMetrics.update.mockResolvedValue({})
    vi.stubGlobal('fetch', fetchImpl)

    await enrichElevateSessionAudio('session-prosody-failure')

    const payload = prismaMock.sessionMetrics.update.mock.calls[0][0].data
    expect(payload.communicationSignals.prosody).toBeUndefined()
    expect(payload.processingStatus.audio_processed).toBe(false)
    expect(payload.processingStatus.audioInputSignature).toBeNull()
    expect(payload.processingStatus.audioEnrichmentStatus).toBe('retry')
    expect(payload.processingStatus.audioEnrichmentAttempts).toBe(2)
    expect(payload.processingStatus.audioEnrichmentNextRetryAt).toEqual(
      expect.any(String),
    )
  })

  it('does not let a failed request erase a concurrent success for the same input', async () => {
    resolveMock.resolveElevateSessionAudio.mockResolvedValue({
      audioPath: '/tmp/current.webm',
      inputSignature: 'sig-2',
    })
    resolveMock.resolveElevateAudioInputSignature.mockResolvedValue('sig-2')
    prismaMock.sessionMetrics.findUnique
      .mockResolvedValueOnce({
        communicationSignals: { prosody: { pitchVariation: 2 } },
        processingStatus: {
          audioInputSignature: 'sig-1',
          audioEnrichmentStatus: 'retry',
        },
      })
      .mockResolvedValueOnce({
        communicationSignals: { prosody: { pitchVariation: 8 } },
        processingStatus: {
          audioInputSignature: 'sig-2',
          audioEnrichmentStatus: 'completed',
        },
        deliveryMetrics: null,
        totalTurns: 3,
      })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('late timeout')))

    await enrichElevateSessionAudio('session-concurrent-success')

    expect(prismaMock.sessionMetrics.update).not.toHaveBeenCalled()
  })

  it('persists a retry when complete session audio cannot yet be resolved', async () => {
    resolveMock.resolveElevateSessionAudio.mockResolvedValue(null)
    resolveMock.resolveElevateAudioInputSignature.mockResolvedValue('sig-pending')
    prismaMock.sessionMetrics.findUnique.mockResolvedValue({
      communicationSignals: { prosody: { pitchVariation: 2 } },
      processingStatus: {
        audioInputSignature: 'sig-old',
        audioEnrichmentAttempts: 0,
      },
      deliveryMetrics: null,
      totalTurns: 3,
    })
    prismaMock.sessionMetrics.update.mockResolvedValue({})

    await enrichElevateSessionAudio('session-waiting-for-audio')

    const payload = prismaMock.sessionMetrics.update.mock.calls[0][0].data
    expect(payload.communicationSignals.prosody).toBeUndefined()
    expect(payload.processingStatus.audioEnrichmentStatus).toBe('retry')
    expect(payload.processingStatus.audioEnrichmentNextRetryAt).toEqual(
      expect.any(String),
    )
  })

  it('durably scans persisted failed enrichment jobs', async () => {
    await sweepAudioEnrichmentRetries(new Date('2026-09-23T01:00:00Z'))

    expect(prismaMock.sessionMetrics.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: expect.arrayContaining([
            {
              processingStatus: {
                path: ['audioEnrichmentStatus'],
                equals: 'retry',
              },
            },
            {
              processingStatus: {
                path: ['audioEnrichmentStatus'],
                equals: 'processing',
              },
            },
          ]),
        },
        orderBy: { sessionId: 'asc' },
        take: 100,
      }),
    )
  })
})
