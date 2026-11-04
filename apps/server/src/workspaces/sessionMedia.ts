import path from 'node:path'
import { constants } from 'node:fs'
import { open, realpath, type FileHandle } from 'node:fs/promises'
import type { Request, Response, NextFunction } from 'express'
import { verifyWorkspaceToken } from '../lib/jwt'
import { WorkspaceError, idSchema } from './contracts'
import { withWorkspaceAccess, type WorkspaceTx, type establishWorkspace } from './context'
import { ownedArchiveSession } from './sessionArchive'

const EXTENSIONS: Record<string, string> = { webm: 'audio/webm', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', ogg: 'audio/ogg' }
const safeId = /^[A-Za-z0-9_-]{1,160}$/
export function workspaceRecordingKey(workspaceId: string, sessionId: string, recordingId: string, extension: string) {
  if (![workspaceId, sessionId, recordingId].every(id => safeId.test(id)) || !Object.hasOwn(EXTENSIONS, extension)) {
    throw new WorkspaceError(400, 'INVALID_RECORDING_ID', 'Invalid recording reference')
  }
  return `workspaces/${workspaceId}/sessions/${sessionId}/${recordingId}.${extension}`
}
export function recordingByteRange(value: string | undefined, size: number) {
  if (!value) return { start: 0, end: size - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2]) || size <= 0) return null
  const left = match[1] ? Number(match[1]) : null
  const right = match[2] ? Number(match[2]) : null
  if ((left !== null && !Number.isSafeInteger(left)) || (right !== null && !Number.isSafeInteger(right))) return null
  if (left === null && (!right || right <= 0)) return null
  const start = left ?? Math.max(0, size - right!)
  const end = left === null || right === null ? size - 1 : Math.min(right, size - 1)
  return start >= size || start > end ? null : { start, end, partial: true }
}
const unavailable = () => new WorkspaceError(404, 'RECORDING_UNAVAILABLE', 'Recording is not available')
export type OpenRecording = { handle: FileHandle; size: number; mime: string }

const inside = (root: string, candidate: string) => {
  const rel = path.relative(root, candidate)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Opens a stored media file only when it lies beneath `<root>/<prefix>/` with no symlink
 * anywhere below the root (including links into another workspace). Absolute stored paths
 * and root-relative keys are both accepted; anything else is unavailable.
 */
export async function openContainedMedia(root: string, prefix: string, storedPath: string, mime: string): Promise<OpenRecording> {
  const configuredRoot = path.resolve(root)
  const candidate = path.isAbsolute(storedPath) ? path.resolve(storedPath) : path.resolve(configuredRoot, storedPath)
  if (!inside(path.resolve(configuredRoot, prefix), candidate)) throw unavailable()
  let handle: FileHandle | undefined
  try {
    const realRoot = await realpath(configuredRoot)
    const expected = path.resolve(realRoot, path.relative(configuredRoot, candidate))
    if (await realpath(expected) !== expected) throw unavailable()
    handle = await open(expected, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0) throw unavailable()
    return { handle, size: stat.size, mime }
  } catch (error) {
    await handle?.close()
    if (error instanceof WorkspaceError) throw error
    throw unavailable()
  }
}

/** Private, non-cacheable byte-range response for an opened file; closes the handle in every path. */
export async function sendOpenRecording(req: Request, res: Response, file: OpenRecording) {
  const range = recordingByteRange(req.headers.range, file.size)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (!range) { await file.handle.close(); res.status(416).setHeader('Content-Range', `bytes */${file.size}`); res.end(); return }
  res.status(range.partial ? 206 : 200)
  res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Type', file.mime)
  res.setHeader('Content-Length', String(range.end - range.start + 1))
  if (range.partial) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`)
  if (req.method === 'HEAD') { await file.handle.close(); res.end(); return }
  const stream = file.handle.createReadStream({ start: range.start, end: range.end, autoClose: true })
  stream.on('error', () => { if (res.headersSent) res.destroy(); else res.status(500).end() })
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}
async function openOwnedRecording(tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>, sessionId: string, recordingId: string): Promise<OpenRecording> {
  await ownedArchiveSession(tx, scope, sessionId)
  const owner = await tx.user.findUniqueOrThrow({ where: { id: scope.member.userId }, select: { hideAudioDownload: true } })
  if (owner.hideAudioDownload) throw new WorkspaceError(403, 'PLAYBACK_DISABLED', 'Audio playback is disabled for your account')
  const recording = await tx.sessionRecording.findFirst({ where: { id: recordingId, sessionId, status: 'completed' }, select: { filePath: true } })
  if (!recording) throw unavailable()
  const extension = path.extname(recording.filePath).slice(1).toLowerCase()
  if (!Object.hasOwn(EXTENSIONS, extension)) throw unavailable()
  const key = workspaceRecordingKey(scope.workspace.id, sessionId, recordingId, extension)
  const configuredRoot = path.resolve(process.env.LOCAL_AUDIO_PATH || path.join(process.cwd(), 'audio_storage'))
  if (recording.filePath !== key && recording.filePath !== path.resolve(configuredRoot, key)) throw unavailable()
  let handle: FileHandle | undefined
  try {
    const root = await realpath(configuredRoot)
    const expected = path.resolve(root, key)
    // Reject symlinks beneath the configured root, including links into another workspace.
    if (await realpath(expected) !== expected) throw unavailable()
    handle = await open(expected, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0) throw unavailable()
    return { handle, size: stat.size, mime: EXTENSIONS[extension] }
  } catch (error) {
    await handle?.close()
    if (error instanceof WorkspaceError) throw error
    throw unavailable()
  }
}

/** Header-authenticated streaming only. No filesystem path or long-lived media token in the URL. */
export async function streamWorkspaceRecording(req: Request, res: Response, next: NextFunction) {
  let recording: OpenRecording | undefined
  try {
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
    let claims
    try { claims = verifyWorkspaceToken(token) } catch { throw new WorkspaceError(401, 'WORKSPACE_TOKEN_REQUIRED', 'Open the workspace again to continue') }
    const sessionId = idSchema.parse(req.params.sessionId), recordingId = idSchema.parse(req.params.recordingId)
    // Track the open descriptor outside the transaction so a failed commit closes it too.
    await withWorkspaceAccess(claims, async (tx, scope) => { recording = await openOwnedRecording(tx, scope, sessionId, recordingId) })
    await sendOpenRecording(req, res, recording!)
  } catch (error) { await recording?.handle.close().catch(() => {}); next(error) }
}
