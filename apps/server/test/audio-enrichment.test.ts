import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  sessionMetrics: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

const resolveMock = vi.hoisted(() => ({
  resolveElevateSessionAudio: vi.fn(),
}))

vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../src/analytics/insightProviders/resolveSessionAudio', () => resolveMock)
vi.mock('../src/lib/sessionDiscard', () => ({
  lockWritableSession: vi.fn(),
}))

import { enrichElevateSessionAudio } from '../src/analytics/audioEnrichment'

describe('late recording enrichment', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    prismaMock.sessionMetrics.findUnique.mockReset()
    prismaMock.sessionMetrics.update.mockReset()
    prismaMock.$transaction.mockReset()
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock))
    resolveMock.resolveElevateSessionAudio.mockReset()
  })

  it('attaches prosody onto existing text metrics without Pulse writes', async () => {
    resolveMock.resolveElevateSessionAudio.mockResolvedValue({ audioPath: '/tmp/session.webm' })
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
  })

  it('rereads status under lock so concurrent pace evidence is preserved', async () => {
    resolveMock.resolveElevateSessionAudio.mockResolvedValue({
      audioPath: '/tmp/session.webm',
      segments: [],
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
    resolveMock.resolveElevateSessionAudio.mockResolvedValue({ audioPath: '/tmp/session.webm' })
    prismaMock.sessionMetrics.findUnique.mockResolvedValue({
      communicationSignals: { prosody: { voiceQuality: 8 } },
      processingStatus: { audioStatus: 'available', audio_processed: true },
    })

    await enrichElevateSessionAudio('session-late')

    expect(prismaMock.sessionMetrics.update).not.toHaveBeenCalled()
  })

  it('does not persist an empty prosody object as acoustic data', async () => {
    resolveMock.resolveElevateSessionAudio.mockResolvedValue({ audioPath: '/tmp/session.webm' })
    prismaMock.sessionMetrics.findUnique.mockResolvedValue({
      communicationSignals: { fillers: { rate: 0.1 } },
      processingStatus: { audioStatus: 'pending', audio_processed: false },
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
    expect(payload.communicationSignals).toBeUndefined()
    expect(payload.processingStatus.audio_processed).toBe(false)
  })
})
