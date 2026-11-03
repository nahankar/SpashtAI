import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => ({
  deleteRecordingArtifact: vi.fn(),
  prisma: { replayDeletion: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() } },
}))
vi.mock('../src/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('../src/lib/sessionStorageCleanup', () => ({ deleteRecordingArtifact: mocks.deleteRecordingArtifact }))
vi.mock('../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { processReplayDeletion } = await import('../src/lib/replayDeletionWorker')

describe('Replay deletion outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.replayDeletion.update.mockResolvedValue({})
    mocks.prisma.replayDeletion.delete.mockResolvedValue({})
  })

  it('removes local files and the transcription input in object storage, then clears the outbox row', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'replay-del-'))
    const local = path.join(dir, 'upload.webm')
    await writeFile(local, 'x')
    const s3 = 's3://bucket/workspaces/ws1/replay/r1/upload.webm'
    mocks.prisma.replayDeletion.findUnique.mockResolvedValue({ replaySessionId: 'r1', attempts: 0, filePaths: [local, path.join(dir, 'missing.json'), s3] })
    mocks.deleteRecordingArtifact.mockResolvedValue(undefined)
    expect(await processReplayDeletion('r1')).toBe(true)
    expect(existsSync(local)).toBe(false)
    expect(mocks.deleteRecordingArtifact).toHaveBeenCalledWith(s3)
    expect(mocks.prisma.replayDeletion.delete).toHaveBeenCalledWith({ where: { replaySessionId: 'r1' } })
  })

  it('keeps the outbox row for retry when object storage cleanup fails', async () => {
    mocks.prisma.replayDeletion.findUnique.mockResolvedValue({ replaySessionId: 'r2', attempts: 1, filePaths: ['s3://bucket/k'] })
    mocks.deleteRecordingArtifact.mockRejectedValue(new Error('AccessDenied'))
    expect(await processReplayDeletion('r2')).toBe(false)
    expect(mocks.prisma.replayDeletion.delete).not.toHaveBeenCalled()
    expect(mocks.prisma.replayDeletion.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { replaySessionId: 'r2' }, data: expect.objectContaining({ status: 'failed' }) }))
  })
})
