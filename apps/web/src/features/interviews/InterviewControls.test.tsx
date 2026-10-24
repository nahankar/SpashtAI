import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoomEvent } from 'livekit-client'
import { InterviewControls } from './InterviewControls'

// Exercise the component's control messages, microphone effects and button
// handlers without acquiring the user's microphone or adding a DOM dependency.
const h = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, effectCursor: 0,
  slots: [] as Array<{ deps?: unknown[]; cleanup?: void | (() => void) }>,
  effects: [] as Array<() => void | (() => void)>,
  listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
  buttons: new Map<string, { disabled?: boolean; onClick: () => void }>(),
  track: { enabled: false }, rpc: vi.fn(),
}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = h.cursor++
    if (!(index in h.states)) h.states[index] = initial
    return [h.states[index], (value: unknown) => { h.states[index] = value }]
  },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = h.effectCursor++, previous = h.slots[index]
    if (deps && previous?.deps && deps.every((value, i) => Object.is(value, previous.deps![i]))) return
    h.effects.push(() => {
      previous?.cleanup?.()
      h.slots[index] = { deps, cleanup: effect() }
    })
  },
}))
const participant = { identity: 'agent', isAgent: true, metadata: '{"interviewRunId":"run"}' }
const room = {
  localParticipant: {
    getTrackPublication: () => ({ track: { mediaStreamTrack: h.track } }),
    on: vi.fn(), off: vi.fn(), performRpc: h.rpc,
  },
  remoteParticipants: new Map([['agent', participant]]),
  on(event: string, handler: (...args: unknown[]) => void) {
    if (!h.listeners.has(event)) h.listeners.set(event, new Set())
    h.listeners.get(event)!.add(handler)
  },
  off(event: string, handler: (...args: unknown[]) => void) { h.listeners.get(event)?.delete(handler) },
}
vi.mock('@livekit/components-react', () => ({ useRoomContext: () => room }))
vi.mock('@/components/ui/button', () => ({ Button: (props: { children: string; disabled?: boolean; onClick: () => void }) => {
  h.buttons.set(props.children, props)
  return <button disabled={props.disabled}>{props.children}</button>
} }))
function render(status = 'ASKED') {
  h.cursor = 0; h.effectCursor = 0; h.effects.length = 0; h.buttons.clear()
  const html = renderToStaticMarkup(<InterviewControls runId="run" attemptId="attempt" segmentId="segment"
    status={status} ready blocked={false} recorder={() => null} changed={vi.fn()} preparing={vi.fn()}
    pause={vi.fn()} leave={vi.fn()} incomplete={vi.fn()} discard={vi.fn()} reconnect={vi.fn()} operationChanged={vi.fn()} />)
  h.effects.forEach(effect => effect())
  return html
}
function control(type: string, text?: string) {
  const bytes = new TextEncoder().encode(JSON.stringify({ type, text }))
  h.listeners.get(RoomEvent.DataReceived)?.forEach(listener => listener(bytes, participant, undefined, 'lk.control'))
}
beforeEach(() => {
  h.slots.splice(0).forEach(slot => slot.cleanup?.())
  h.states.length = 0; h.listeners.clear(); h.track.enabled = false; h.rpc.mockReset()
})
describe('interview time limit and the current answer', () => {
  it('opens the microphone when an expired practice resumes and the question becomes ready', () => {
    render(); control('interview_time_up'); control('session_state', 'ready'); render(); render()
    expect(h.track.enabled).toBe(true)
    expect(h.buttons.get('Mute')?.disabled).toBe(false)
    expect(h.buttons.get('Finish answer')?.disabled).toBe(false)
    expect(render()).toContain('Finish your current answer')
    render('ANSWERED')
    expect(h.track.enabled).toBe(false)
    expect(h.buttons.get('Next question')?.disabled).toBe(true)
  })
  it('allows manual mute and unmute after the timer expires', () => {
    render(); control('session_state', 'ready'); render(); render()
    control('interview_time_up'); render()
    expect(h.track.enabled).toBe(true)
    h.buttons.get('Mute')!.onClick(); render()
    expect(h.track.enabled).toBe(false)
    expect(h.buttons.get('Unmute')?.disabled).toBe(false)
    h.buttons.get('Unmute')!.onClick()
    expect(h.track.enabled).toBe(true)
  })
  it('still mutes and locks the microphone while saving an expired answer', () => {
    render(); control('interview_time_up'); control('session_state', 'ready'); render(); render()
    h.rpc.mockImplementation(() => new Promise(() => {}))
    h.buttons.get('Finish answer')!.onClick(); render(); render()
    expect(h.track.enabled).toBe(false)
    expect(h.buttons.get('Unmute')?.disabled).toBe(true)
    expect(render()).toContain('Saving and confirming your speech')
  })
})
