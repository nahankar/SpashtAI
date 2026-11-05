import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Room = { name: string; metadata?: string }
const lk = vi.hoisted(() => ({
  rooms: new Map<string, Room>(),
  deleted: [] as string[],
  listed: [] as string[][],
  deleteError: null as null | ((name: string) => Error | null),
}))
vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {
    async listRooms(names: string[]) { lk.listed.push(names); return names.flatMap(name => lk.rooms.get(name) ?? []) }
    async deleteRoom(name: string) {
      const error = lk.deleteError?.(name)
      if (error) throw error
      if (!lk.rooms.has(name)) throw Object.assign(new Error('room not found'), { status: 404 })
      lk.deleted.push(name)
      lk.rooms.delete(name)
    }
  },
}))
import { classifySegmentRooms, releaseSegmentRooms, releaseSegmentRoomsWithRetry, segmentRoomName } from '../src/lib/livekitRooms'

const env = { LIVEKIT_URL: process.env.LIVEKIT_URL, LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY, LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET }
const meta = (sessionId: string, segmentId: string) => JSON.stringify({ sessionId, segmentId })
const own = (sessionId: string, id: string) => ({ id, sessionId, roomName: segmentRoomName(sessionId, id) })

describe('LiveKit room ownership and release', () => {
  beforeEach(() => {
    process.env.LIVEKIT_URL = 'wss://livekit.example'
    process.env.LIVEKIT_API_KEY = 'key'
    process.env.LIVEKIT_API_SECRET = 'secret'
    lk.rooms.clear(); lk.deleted.length = 0; lk.listed.length = 0; lk.deleteError = null
  })
  afterEach(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('derives an unguessable room name bound to one session and segment', () => {
    const name = segmentRoomName('session-a', 'segment-1')
    expect(name).toMatch(/^lk_[A-Za-z0-9_-]{32}$/)
    expect(segmentRoomName('session-a', 'segment-1')).toBe(name)
    expect(segmentRoomName('session-b', 'segment-1')).not.toBe(name)
    expect(segmentRoomName('session-a', 'segment-2')).not.toBe(name)
    expect(segmentRoomName('session-a:segment', '1')).not.toBe(segmentRoomName('session-a', 'segment:1'))
  })

  it('closes its own derived room and treats an already-missing room as closed', async () => {
    const segment = own('session-a', 'segment-1')
    lk.rooms.set(segment.roomName, { name: segment.roomName, metadata: meta('session-a', 'segment-1') })
    await expect(releaseSegmentRooms([segment])).resolves.toMatchObject({ owned: [segment.roomName] })
    expect(lk.deleted).toEqual([segment.roomName])
    await expect(releaseSegmentRoomsWithRetry([segment])).resolves.toMatchObject({ owned: [segment.roomName] })
    expect(lk.listed).toEqual([])
  })

  it('never closes a foreign room named by a stored legacy segment', async () => {
    lk.rooms.set('victim-room', { name: 'victim-room', metadata: meta('victim-session', 'victim-segment') })
    const forged = { id: 'attacker-segment', sessionId: 'attacker-session', roomName: 'victim-room' }
    const result = await releaseSegmentRooms([forged])
    expect(result).toEqual({ owned: [], foreign: ['victim-room'], unverified: [] })
    expect(lk.deleted).toEqual([])
    expect(lk.rooms.has('victim-room')).toBe(true)
  })

  it('closes a legacy room only when LiveKit shows it belongs to that segment, and ignores absent legacy rooms', async () => {
    lk.rooms.set('room_legacy', { name: 'room_legacy', metadata: meta('session-a', 'segment-legacy') })
    const result = await classifySegmentRooms([
      { id: 'segment-legacy', sessionId: 'session-a', roomName: 'room_legacy' },
      { id: 'segment-gone', sessionId: 'session-a', roomName: 'room_gone' },
    ])
    expect(result).toEqual({ owned: ['room_legacy'], foreign: [], unverified: ['room_gone'] })
    await releaseSegmentRooms([{ id: 'segment-legacy', sessionId: 'session-a', roomName: 'room_legacy' }])
    expect(lk.deleted).toEqual(['room_legacy'])
  })

  it('does not trust a forged derived-looking name for a different segment', async () => {
    const victim = own('victim-session', 'victim-segment')
    lk.rooms.set(victim.roomName, { name: victim.roomName, metadata: meta('victim-session', 'victim-segment') })
    const result = await releaseSegmentRooms([{ id: 'attacker-segment', sessionId: 'attacker-session', roomName: victim.roomName }])
    expect(result.foreign).toEqual([victim.roomName])
    expect(lk.deleted).toEqual([])
  })

  it.each(['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'])('fails closed without %s when any room must be closed', async (missing) => {
    delete process.env[missing]
    await expect(releaseSegmentRooms([own('session-a', 'segment-1')])).rejects.toThrow('LiveKit is not configured')
    await expect(releaseSegmentRooms([{ id: 'segment-legacy', sessionId: 'session-a', roomName: 'room_legacy' }])).rejects.toThrow('LiveKit is not configured')
    await expect(releaseSegmentRoomsWithRetry([own('session-a', 'segment-1')])).rejects.toThrow('LiveKit is not configured')
    await expect(releaseSegmentRooms([])).resolves.toEqual({ owned: [], foreign: [], unverified: [] })
  })

  it('retries a failed close once, succeeds on retry, and throws when both attempts fail', async () => {
    const segment = own('session-a', 'segment-1')
    lk.rooms.set(segment.roomName, { name: segment.roomName })
    let failures = 1
    lk.deleteError = () => failures-- > 0 ? new Error('livekit unavailable') : null
    await expect(releaseSegmentRoomsWithRetry([segment])).resolves.toMatchObject({ owned: [segment.roomName] })
    expect(lk.deleted).toEqual([segment.roomName])

    lk.rooms.set(segment.roomName, { name: segment.roomName })
    lk.deleteError = () => new Error('livekit unavailable')
    await expect(releaseSegmentRoomsWithRetry([segment])).rejects.toThrow('Failed to close 1 LiveKit room(s)')
    expect(lk.rooms.has(segment.roomName)).toBe(true)
  })
})
