import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/prisma', () => ({ prisma: {} }))

import { downloadFilename } from '../src/routes/downloads'

const sessionId = 'session_1790050052638_4m2z3a2mc'

describe('Elevate audio download naming', () => {
  it('resolves the real container for opaque segment uploads', () => {
    expect(
      downloadFilename(sessionId, {
        filePath: '/opt/spashtai/audio_storage/elevate-segment-a74b13d9.audio',
        mimeType: 'audio/webm',
        recordingType: 'user',
        segment: { segmentIndex: 0 },
      }),
    ).toBe(`${sessionId}-user-part1.webm`)
  })

  it('keeps a known stored extension when no mimeType was recorded', () => {
    expect(
      downloadFilename(sessionId, {
        filePath: '/out/participant_user_abc.mp4',
        mimeType: null,
        recordingType: 'user',
        segment: null,
      }),
    ).toBe(`${sessionId}-user.mp4`)
  })

  it('never emits the unplayable .audio extension', () => {
    expect(
      downloadFilename(sessionId, {
        filePath: '/out/elevate-segment-a74b13d9.audio',
        mimeType: null,
        recordingType: 'agent',
        segment: null,
      }),
    ).toBe(`${sessionId}-agent.webm`)
  })
})
