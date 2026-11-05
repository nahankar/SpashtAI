import { RoomServiceClient } from 'livekit-server-sdk'
import { serverDigest } from './jwt'
import { logger } from './logger'

function livekitConfig() {
  const url = process.env.LIVEKIT_URL || ''
  return {
    httpUrl: url.startsWith('wss://')
      ? url.replace('wss://', 'https://')
      : url.replace('ws://', 'http://'),
    apiKey: process.env.LIVEKIT_API_KEY || '',
    apiSecret: process.env.LIVEKIT_API_SECRET || '',
  }
}

function roomService(): RoomServiceClient {
  const { httpUrl, apiKey, apiSecret } = livekitConfig()
  if (!httpUrl || !apiKey || !apiSecret) {
    throw new Error('LiveKit is not configured; live rooms cannot be verified or closed')
  }
  return new RoomServiceClient(httpUrl, apiKey, apiSecret)
}

/**
 * The only room name a segment may use: a keyed digest of its session and segment ids. Clients never choose
 * room names, so a learner cannot register, pre-claim, join or close another learner's or workspace's room.
 */
export function segmentRoomName(sessionId: string, segmentId: string): string {
  return `lk_${serverDigest('livekit-room:v1', JSON.stringify([sessionId, segmentId])).slice(0, 32)}`
}

export type SegmentRoom = { id: string; sessionId: string; roomName: string }

function isDerivedRoom(segment: SegmentRoom): boolean {
  return segment.roomName === segmentRoomName(segment.sessionId, segment.id)
}

function ignorableRoomError(error: unknown): boolean {
  const candidate = error as {
    status?: number
    statusCode?: number
    code?: string | number
    message?: string
  }
  const code = String(candidate?.code ?? '').toLowerCase()
  const message = String(candidate?.message ?? '').toLowerCase()
  return (
    candidate?.status === 404 ||
    candidate?.statusCode === 404 ||
    code === 'not_found' ||
    code === 'notfound' ||
    message.includes('room not found')
  )
}

function roomMetadata(value: string | undefined): { sessionId?: unknown; segmentId?: unknown } {
  try {
    const parsed = value ? JSON.parse(value) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export interface RoomOwnership {
  /** Rooms this session's segments verifiably own (derived name, or a live room whose metadata names the segment). */
  owned: string[]
  /** Live rooms whose metadata names another activity: never closed, never used for egress or storage. */
  foreign: string[]
  /** Legacy client-chosen names with no live room: ownership cannot be proven, so nothing is done with them. */
  unverified: string[]
}

/**
 * Classifies stored segment room names. Legacy (pre-derived) names are trusted only while LiveKit shows the room
 * with this segment's metadata, which token issuance always writes. Any room to verify requires configuration.
 */
export async function classifySegmentRooms(segments: SegmentRoom[]): Promise<RoomOwnership> {
  const result: RoomOwnership = { owned: [], foreign: [], unverified: [] }
  const legacy: SegmentRoom[] = []
  for (const segment of segments) {
    if (!segment.roomName) continue
    if (isDerivedRoom(segment)) result.owned.push(segment.roomName)
    else legacy.push(segment)
  }
  if (legacy.length) {
    const names = [...new Set(legacy.map(segment => segment.roomName))]
    const live = new Map((await roomService().listRooms(names)).map(room => [room.name, roomMetadata(room.metadata)]))
    for (const segment of legacy) {
      const metadata = live.get(segment.roomName)
      if (!metadata) result.unverified.push(segment.roomName)
      else if (metadata.sessionId === segment.sessionId && metadata.segmentId === segment.id) result.owned.push(segment.roomName)
      else result.foreign.push(segment.roomName)
    }
  }
  const unique = (names: string[]) => [...new Set(names)]
  const owned = unique(result.owned)
  return { owned, foreign: unique(result.foreign).filter(name => !owned.includes(name)), unverified: unique(result.unverified) }
}

/** Ends rooms already verified as owned. Missing rooms are ignored; any other failure (or missing config) throws. */
async function deleteOwnedRooms(roomNames: string[]): Promise<void> {
  const names = [...new Set(roomNames.filter(Boolean))]
  if (names.length === 0) return
  const service = roomService()
  const results = await Promise.allSettled(names.map(roomName => service.deleteRoom(roomName)))
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason)
    .filter(error => !ignorableRoomError(error))
  if (failures.length > 0) {
    throw new AggregateError(failures, `Failed to close ${failures.length} LiveKit room(s)`)
  }
}

/**
 * Closes the rooms these segments own so the other tab/device disconnects. Rooms owned by another activity are
 * left untouched. Throws when ownership cannot be checked or a close cannot be confirmed (including missing
 * configuration), so callers must keep occupancy rather than claim the previous connection ended.
 */
export async function releaseSegmentRooms(segments: SegmentRoom[]): Promise<RoomOwnership> {
  const ownership = await classifySegmentRooms(segments)
  if (ownership.foreign.length) {
    logger.warn({ foreignRooms: ownership.foreign.length }, 'Ignored segment room names owned by another activity')
  }
  await deleteOwnedRooms(ownership.owned)
  return ownership
}

/** One retry, then fail. Callers must not treat a thrown error as a confirmed disconnect. */
export async function releaseSegmentRoomsWithRetry(segments: SegmentRoom[]): Promise<RoomOwnership> {
  try {
    return await releaseSegmentRooms(segments)
  } catch (first) {
    try {
      return await releaseSegmentRooms(segments)
    } catch (second) {
      logger.error({ err: second, prior: first, segments: segments.map(segment => segment.id) }, 'Failed to close LiveKit rooms after retry')
      throw second
    }
  }
}
