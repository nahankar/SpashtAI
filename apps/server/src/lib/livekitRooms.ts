import { RoomServiceClient } from 'livekit-server-sdk'
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

/** Ends LiveKit rooms so the other tab/device disconnects. Missing rooms are ignored. */
export async function deleteLivekitRooms(roomNames: string[]): Promise<void> {
  const names = [...new Set(roomNames.filter(Boolean))]
  const { httpUrl, apiKey, apiSecret } = livekitConfig()
  if (!httpUrl || !apiKey || !apiSecret || names.length === 0) return
  const service = new RoomServiceClient(httpUrl, apiKey, apiSecret)
  const results = await Promise.allSettled(names.map(roomName => service.deleteRoom(roomName)))
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason)
    .filter(error => !ignorableRoomError(error))
  if (failures.length > 0) {
    throw new AggregateError(failures, `Failed to close ${failures.length} LiveKit room(s)`)
  }
}

/** Takeover must not fail the new start if LiveKit is briefly unreachable. */
export async function releaseLivekitRooms(roomNames: string[]): Promise<void> {
  try {
    await deleteLivekitRooms(roomNames)
  } catch (error) {
    logger.error({ err: error, rooms: roomNames }, 'Failed to close taken-over LiveKit rooms')
  }
}
