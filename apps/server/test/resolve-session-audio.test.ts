import { writeFileSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { isAbsolute, join, relative } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    sessionSegment: { findMany: vi.fn() },
    sessionRecording: { findMany: vi.fn(), findUnique: vi.fn() },
  },
  ffmpegArgs: [] as string[][],
  execOptions: [] as unknown[],
}))

vi.mock('../src/lib/prisma', () => ({ prisma: mocks.prisma }))

// Stand in for ffmpeg so these tests assert path shape, not encoding.
vi.mock('child_process', () => ({
  execFile: (
    cmd: string,
    args: string[],
    optionsOrCallback: unknown,
    maybeCallback?: (err: Error | null, out: unknown) => void,
  ) => {
    const cb =
      typeof optionsOrCallback === 'function'
        ? (optionsOrCallback as (err: Error | null, out: unknown) => void)
        : maybeCallback!
    mocks.execOptions.push(typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback)
    mocks.ffmpegArgs.push(args)
    if (cmd === 'ffprobe') {
      cb(null, { stdout: '7.25\n', stderr: '' })
      return
    }
    writeFileSync(args[args.length - 1], Buffer.alloc(64))
    cb(null, { stdout: '', stderr: '' })
  },
}))

describe('resolveElevateSessionAudio path contract', () => {
  let audioDir: string
  let cwdSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.ffmpegArgs.length = 0
    mocks.execOptions.length = 0
    audioDir = await mkdtemp(join(tmpdir(), 'spasht-audio-'))
    // The signal API is a separate process with its own working directory, so
    // any path we hand it has to be absolute regardless of ours.
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(audioDir)
    mocks.prisma.sessionRecording.findMany.mockResolvedValue([])
  })

  afterEach(async () => {
    cwdSpy.mockRestore()
    delete process.env.LOCAL_AUDIO_PATH
    await rm(audioDir, { recursive: true, force: true })
  })

  async function segment(index: number, fileName: string) {
    const filePath = join(audioDir, fileName)
    await writeFile(filePath, Buffer.alloc(2048))
    return {
      id: `segment-${index}`,
      segmentIndex: index,
      audioStatus: 'available',
      recordingDurationSec: 10 + index,
      recording: {
        filePath,
        duration: 10 + index,
        mimeType: 'audio/webm',
        updatedAt: new Date(`2026-09-20T18:0${index}:00Z`),
      },
    }
  }

  it('returns an absolute merged path when LOCAL_AUDIO_PATH is relative', async () => {
    process.env.LOCAL_AUDIO_PATH = relative(process.cwd(), audioDir) || '.'
    mocks.prisma.sessionSegment.findMany.mockResolvedValue([
      await segment(0, 'seg-0.webm'),
      await segment(1, 'seg-1.webm'),
    ])

    const { resolveElevateSessionAudio } = await import(
      '../src/analytics/insightProviders/resolveSessionAudio'
    )
    const resolved = await resolveElevateSessionAudio('session-multi')

    expect(resolved?.audioPath).toBeTruthy()
    expect(isAbsolute(resolved!.audioPath)).toBe(true)
    expect(resolved?.segments).toEqual([
      { segmentId: 'segment-0', segmentIndex: 0, replayOffsetSec: 0, durationSec: 10 },
      { segmentId: 'segment-1', segmentIndex: 1, replayOffsetSec: 10, durationSec: 11 },
    ])
  })

  it('falls back to media duration when persisted duration is zero', async () => {
    const { resolvePositiveSegmentDuration } = await import(
      '../src/analytics/insightProviders/resolveSessionAudio'
    )
    expect(resolvePositiveSegmentDuration(0, 12.5)).toBe(12.5)
    expect(resolvePositiveSegmentDuration(Number.NaN, 9)).toBe(9)
  })

  it('probes readable media when both persisted durations are zero', async () => {
    const zeroDuration = await segment(0, 'zero-duration.webm')
    zeroDuration.recordingDurationSec = 0
    zeroDuration.recording.duration = 0
    mocks.prisma.sessionSegment.findMany.mockResolvedValue([zeroDuration])

    const { resolveElevateSessionAudio } = await import(
      '../src/analytics/insightProviders/resolveSessionAudio'
    )
    const resolved = await resolveElevateSessionAudio('session-probed-duration')

    expect(resolved?.segments[0].durationSec).toBe(7.25)
    expect(mocks.execOptions).toContainEqual(
      expect.objectContaining({ timeout: 5_000 }),
    )
  })

  it('returns an absolute path for a single segment', async () => {
    process.env.LOCAL_AUDIO_PATH = relative(process.cwd(), audioDir) || '.'
    mocks.prisma.sessionSegment.findMany.mockResolvedValue([await segment(0, 'only.webm')])

    const { resolveElevateSessionAudio } = await import(
      '../src/analytics/insightProviders/resolveSessionAudio'
    )
    const resolved = await resolveElevateSessionAudio('session-single')

    expect(isAbsolute(resolved!.audioPath)).toBe(true)
    expect(resolved?.audioMime).toBe('audio/webm')
  })

  it('omits a missing middle file from both merge and timeline offsets', async () => {
    const first = await segment(0, 'first.webm')
    const missing = {
      ...(await segment(1, 'missing.webm')),
      recording: {
        ...(await segment(1, 'missing.webm')).recording,
        filePath: join(audioDir, 'does-not-exist.webm'),
      },
    }
    const last = await segment(2, 'last.webm')
    mocks.prisma.sessionSegment.findMany.mockResolvedValue([first, missing, last])

    const { resolveElevateSessionAudio } = await import(
      '../src/analytics/insightProviders/resolveSessionAudio'
    )
    const resolved = await resolveElevateSessionAudio('session-missing-middle')

    expect(resolved?.segments).toEqual([
      { segmentId: 'segment-0', segmentIndex: 0, replayOffsetSec: 0, durationSec: 10 },
      { segmentId: 'segment-2', segmentIndex: 2, replayOffsetSec: 10, durationSec: 12 },
    ])
    expect(
      await resolveElevateSessionAudio('session-missing-middle', {
        requireCompleteSegments: true,
      }),
    ).toBeNull()
  })

  it.each(['unavailable', 'failed'])(
    'keeps terminal %s pause segments out of Replay but refuses them for complete delivery audio',
    async (audioStatus) => {
      const available = await segment(0, 'available.webm')
      const unavailable = await segment(1, 'unavailable-pause.webm')
      unavailable.audioStatus = audioStatus
      ;(unavailable as any).recording = null
      mocks.prisma.sessionSegment.findMany.mockResolvedValue([
        available,
        unavailable,
      ])

      const { resolveElevateSessionAudio } = await import(
        '../src/analytics/insightProviders/resolveSessionAudio'
      )
      const replay = await resolveElevateSessionAudio('session-paused')
      expect(replay?.segments.map((item) => item.segmentId)).toEqual([
        available.id,
      ])
      const delivery = await resolveElevateSessionAudio('session-paused', {
        requireCompleteSegments: true,
      })
      expect(delivery).toBeNull()
    },
  )

  it('does not fall back to one arbitrary recording for a segmented session', async () => {
    const unavailable = await segment(0, 'unavailable.webm')
    unavailable.audioStatus = 'pending'
    mocks.prisma.sessionSegment.findMany.mockResolvedValue([unavailable])
    mocks.prisma.sessionRecording.findMany.mockResolvedValue([
      {
        recordingType: 'user',
        filePath: unavailable.recording.filePath,
        mimeType: 'audio/webm',
      },
    ])

    const { resolveElevateSessionAudio } = await import(
      '../src/analytics/insightProviders/resolveSessionAudio'
    )
    expect(await resolveElevateSessionAudio('session-partial-only')).toBeNull()
    expect(mocks.prisma.sessionRecording.findMany).not.toHaveBeenCalled()
  })

  it('resolves a relatively stored recording path to an absolute path', async () => {
    process.env.LOCAL_AUDIO_PATH = audioDir
    await writeFile(join(audioDir, 'legacy.webm'), Buffer.alloc(1024))
    mocks.prisma.sessionSegment.findMany.mockResolvedValue([])
    mocks.prisma.sessionRecording.findMany.mockResolvedValue([
      {
        recordingType: 'user',
        filePath: 'legacy.webm',
        mimeType: 'audio/webm',
        status: 'completed',
      },
    ])

    const { resolveElevateSessionAudio } = await import(
      '../src/analytics/insightProviders/resolveSessionAudio'
    )
    const resolved = await resolveElevateSessionAudio('session-legacy')

    expect(isAbsolute(resolved!.audioPath)).toBe(true)
  })
})
