import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { EgressClient } from 'livekit-server-sdk'
import { existsSync } from 'fs'
import { readdir, unlink } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { awsCredentialsConfig } from './awsCredentials'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const serverAudioRoot = process.env.LOCAL_AUDIO_PATH
  ? resolve(process.env.LOCAL_AUDIO_PATH)
  : join(moduleDir, '../../audio_storage')
const agentAudioRoot = join(moduleDir, '../../../agent/audio_storage')

function livekitHttpUrl(): string | null {
  const url = process.env.LIVEKIT_URL || ''
  if (!url) return null
  return url.startsWith('wss://')
    ? url.replace('wss://', 'https://')
    : url.replace('ws://', 'http://')
}

function collectStoragePaths(value: unknown, output: Set<string>, seen = new Set<object>()): void {
  if (typeof value === 'string') {
    if (value.startsWith('s3://') || value.startsWith('/out/')) output.add(value)
    return
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item) => collectStoragePaths(item, output, seen))
    return
  }
  Object.values(value).forEach((item) => collectStoragePaths(item, output, seen))
}

export async function stopSessionEgress(roomNames: string[]): Promise<Set<string>> {
  const paths = new Set<string>()
  const url = livekitHttpUrl()
  const apiKey = process.env.LIVEKIT_API_KEY || ''
  const apiSecret = process.env.LIVEKIT_API_SECRET || ''
  if (!url || !apiKey || !apiSecret) return paths

  const client = new EgressClient(url, apiKey, apiSecret)
  for (const roomName of [...new Set(roomNames)]) {
    const active = await client.listEgress({ roomName, active: true })
    active.forEach((egress) => collectStoragePaths(egress, paths))
    // The agent may stop the same Egress concurrently after the browser leaves.
    // Treat a stop rejection as a race, then verify terminal state explicitly.
    const stopped = await Promise.allSettled(
      active.map((egress) => client.stopEgress(egress.egressId)),
    )
    stopped.forEach((result) => {
      if (result.status === 'fulfilled') collectStoragePaths(result.value, paths)
    })
    const all = await client.listEgress({ roomName })
    all.forEach((egress) => collectStoragePaths(egress, paths))
    const stillActive = await client.listEgress({ roomName, active: true })
    if (stillActive.length > 0) {
      throw new Error(`Could not stop ${stillActive.length} active Egress job(s) for ${roomName}`)
    }
  }
  return paths
}

function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  if (!uri.startsWith('s3://')) return null
  const withoutScheme = uri.slice('s3://'.length)
  const separator = withoutScheme.indexOf('/')
  if (separator <= 0 || separator === withoutScheme.length - 1) return null
  return {
    bucket: withoutScheme.slice(0, separator),
    key: decodeURIComponent(withoutScheme.slice(separator + 1)),
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function resolveLocalRecordingPath(storedPath: string): string | null {
  let candidate: string
  if (storedPath.startsWith('/out/')) {
    candidate = join(agentAudioRoot, storedPath.slice('/out/'.length))
  } else if (isAbsolute(storedPath)) {
    candidate = resolve(storedPath)
  } else {
    candidate = join(serverAudioRoot, storedPath)
  }
  return isInside(serverAudioRoot, candidate) || isInside(agentAudioRoot, candidate)
    ? candidate
    : null
}

async function generatedMergedFiles(sessionId: string): Promise<string[]> {
  const prefix = `elevate-merged-${sessionId}-`
  const files: string[] = []
  for (const root of [serverAudioRoot, agentAudioRoot]) {
    if (!existsSync(root)) continue
    const names = await readdir(root)
    names
      .filter((name) => name.startsWith(prefix))
      .forEach((name) => files.push(join(root, name)))
  }
  return files
}

export async function deleteSessionStorage(
  sessionId: string,
  storedPaths: Iterable<string>,
): Promise<void> {
  const s3Objects = new Map<string, { bucket: string; key: string }>()
  const localPaths = new Set<string>()

  for (const storedPath of storedPaths) {
    const s3 = parseS3Uri(storedPath)
    if (s3) {
      s3Objects.set(`${s3.bucket}/${s3.key}`, s3)
      continue
    }
    const local = resolveLocalRecordingPath(storedPath)
    if (local) localPaths.add(local)
  }
  ;(await generatedMergedFiles(sessionId)).forEach((filePath) => localPaths.add(filePath))

  const region = process.env.AWS_REGION || 'us-east-1'
  const s3 = new S3Client({ region, ...awsCredentialsConfig() })
  const results = await Promise.allSettled([
    ...[...s3Objects.values()].map(({ bucket, key }) =>
      s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch((error: any) => {
        const status = error?.$metadata?.httpStatusCode
        if (
          status === 404 ||
          error?.name === 'NoSuchBucket' ||
          error?.name === 'NoSuchKey' ||
          error?.name === 'NotFound'
        ) {
          return
        }
        throw error
      }),
    ),
    ...[...localPaths].map((filePath) =>
      unlink(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      }),
    ),
  ])
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `Failed to remove ${failures.length} recording object(s)`,
    )
  }
}
