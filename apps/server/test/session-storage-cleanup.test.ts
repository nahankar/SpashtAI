import { existsSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  listEgress: vi.fn(),
  stopEgress: vi.fn(),
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mocks.deleteObject
  },
  DeleteObjectCommand: class {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  },
}))
vi.mock('livekit-server-sdk', () => ({
  EgressClient: class {
    listEgress = mocks.listEgress
    stopEgress = mocks.stopEgress
  },
}))

describe('session recording storage cleanup', () => {
  let audioRoot: string
  let outsideRoot: string

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    audioRoot = await mkdtemp(join(tmpdir(), 'spasht-session-audio-'))
    outsideRoot = await mkdtemp(join(tmpdir(), 'spasht-outside-audio-'))
    process.env.LOCAL_AUDIO_PATH = audioRoot
    process.env.LIVEKIT_URL = 'ws://localhost:7880'
    process.env.LIVEKIT_API_KEY = 'key'
    process.env.LIVEKIT_API_SECRET = 'secret'
  })

  afterEach(async () => {
    delete process.env.LOCAL_AUDIO_PATH
    delete process.env.LIVEKIT_URL
    delete process.env.LIVEKIT_API_KEY
    delete process.env.LIVEKIT_API_SECRET
    await rm(audioRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  })

  it('deletes canonical and generated merged local files', async () => {
    const canonical = join(audioRoot, 'segment.webm')
    const merged = join(audioRoot, 'elevate-merged-session-1-signature.webm')
    await writeFile(canonical, 'audio')
    await writeFile(merged, 'merged')

    const { deleteSessionStorage } = await import('../src/lib/sessionStorageCleanup')
    await deleteSessionStorage('session-1', [canonical])

    expect(existsSync(canonical)).toBe(false)
    expect(existsSync(merged)).toBe(false)
  })

  it('never unlinks a database path outside approved audio roots', async () => {
    const unrelated = join(outsideRoot, 'do-not-delete.txt')
    await writeFile(unrelated, 'keep')

    const { deleteSessionStorage } = await import('../src/lib/sessionStorageCleanup')
    await deleteSessionStorage('session-2', [unrelated])

    expect(existsSync(unrelated)).toBe(true)
  })

  it('treats an already-absent S3 bucket as successfully cleaned', async () => {
    mocks.deleteObject.mockRejectedValue({
      name: 'NoSuchBucket',
      $metadata: { httpStatusCode: 404 },
    })

    const { deleteSessionStorage } = await import('../src/lib/sessionStorageCleanup')
    await expect(
      deleteSessionStorage('session-3', ['s3://missing-bucket/session-3.webm']),
    ).resolves.toBeUndefined()
  })

  it('tolerates the agent winning a concurrent Egress stop race', async () => {
    const egress = {
      egressId: 'EG_1',
      request: { value: { file: { filepath: 's3://bucket/session-4.webm' } } },
    }
    mocks.listEgress
      .mockResolvedValueOnce([egress])
      .mockResolvedValueOnce([egress])
      .mockResolvedValueOnce([])
    mocks.stopEgress.mockRejectedValue(new Error('already stopped'))

    const { stopSessionEgress } = await import('../src/lib/sessionStorageCleanup')
    const paths = await stopSessionEgress(['room-4'])

    expect(paths.has('s3://bucket/session-4.webm')).toBe(true)
  })
})
