import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoomEvent } from 'livekit-client'
import { LiveKitConversation } from './LiveKitConversation'

// Run the component's registered room listeners without a DOM or microphone.
// React still supplies the actual refs and callbacks used by those listeners.
const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  listeners: new Map<string, (...args: unknown[]) => void>(),
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect) },
}))
vi.mock('@livekit/components-react', () => ({
  useConnectionState: () => 'connected',
  useVoiceAssistant: () => ({ agentTranscriptions: [] }),
  useRoomContext: () => ({
    remoteParticipants: new Map(),
    on: (event: string, handler: (...args: unknown[]) => void) => harness.listeners.set(event, handler),
    off: (event: string) => harness.listeners.delete(event),
  }),
}))
const cleanups: Array<() => void> = []
beforeEach(() => {
  harness.effects.length = 0
  harness.listeners.clear()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks() })
function mount(paused = false) {
  const onStateChange = vi.fn(), onRestart = vi.fn(), onNewMessage = vi.fn()
  renderToStaticMarkup(<LiveKitConversation sessionId="session" isSessionPaused={paused}
    onStateChange={onStateChange} onRestart={onRestart} onNewMessage={onNewMessage} onMetricsUpdate={vi.fn()} />)
  for (const effect of harness.effects) {
    const cleanup = effect()
    if (cleanup) cleanups.push(cleanup)
  }
  const control = (state: string) => harness.listeners.get(RoomEvent.DataReceived)?.(
    new TextEncoder().encode(JSON.stringify({ type: 'session_state', text: state })), undefined, undefined, 'lk.control')
  return { onStateChange, onRestart, onNewMessage, control }
}
describe('shared room readiness acknowledgments', () => {
  it('restores readiness for question two after the owner starts waiting again', () => {
    const room = mount()
    let ownerState = 'unknown'
    room.onStateChange.mockImplementation(state => { ownerState = state })
    room.control('ready')
    expect(ownerState).toBe('ready')
    // Next question sets the owner to unknown; the agent does not publish a
    // matching unknown event before its second ready acknowledgment.
    ownerState = 'unknown'
    room.control('ready')
    expect(ownerState).toBe('ready')
    expect(room.onStateChange.mock.calls).toEqual([['ready'], ['ready']])
  })
  it('keeps repeated restart notifications from restarting the conversation twice', () => {
    const room = mount()
    room.control('restarting'); room.control('restarting')
    expect(room.onRestart).toHaveBeenCalledOnce()
    expect(room.onStateChange).toHaveBeenCalledOnce()
    room.control('ready'); room.control('restarting')
    expect(room.onRestart).toHaveBeenCalledTimes(2)
  })
  it('does not reopen paused capture when a delayed ready message arrives', () => {
    const room = mount(true)
    room.control('ready')
    expect(room.onStateChange).not.toHaveBeenCalled()
  })
  it('unregisters its room listeners when unmounted', () => {
    mount()
    expect(harness.listeners.has(RoomEvent.DataReceived)).toBe(true)
    cleanups.splice(0).forEach(cleanup => cleanup())
    expect(harness.listeners.size).toBe(0)
  })
})
