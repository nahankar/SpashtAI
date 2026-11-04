import { afterEach, describe, expect, it, vi } from 'vitest'

describe('LiveKit room release', () => {
  const env = {
    LIVEKIT_URL: process.env.LIVEKIT_URL,
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('retries once and then throws so callers cannot claim the room ended', async () => {
    vi.doMock('livekit-server-sdk', () => ({
      RoomServiceClient: class {
        deleteRoom() {
          return Promise.reject(new Error('livekit unavailable'))
        }
      },
    }))
    process.env.LIVEKIT_URL = 'https://livekit.example'
    process.env.LIVEKIT_API_KEY = 'key'
    process.env.LIVEKIT_API_SECRET = 'secret'
    const { deleteLivekitRoomsWithRetry } = await import('../src/lib/livekitRooms')
    await expect(deleteLivekitRoomsWithRetry(['room-old'])).rejects.toThrow('Failed to close 1 LiveKit room(s)')
  })

  it('treats a missing room as already closed', async () => {
    vi.doMock('livekit-server-sdk', () => ({
      RoomServiceClient: class {
        deleteRoom() {
          return Promise.reject(Object.assign(new Error('room not found'), { status: 404 }))
        }
      },
    }))
    process.env.LIVEKIT_URL = 'https://livekit.example'
    process.env.LIVEKIT_API_KEY = 'key'
    process.env.LIVEKIT_API_SECRET = 'secret'
    const { deleteLivekitRoomsWithRetry } = await import('../src/lib/livekitRooms')
    await expect(deleteLivekitRoomsWithRetry(['already-gone'])).resolves.toBeUndefined()
  })
})
