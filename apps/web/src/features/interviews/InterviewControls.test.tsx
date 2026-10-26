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
function render(status = 'ASKED', conversation = false) {
  h.cursor = 0; h.effectCursor = 0; h.effects.length = 0; h.buttons.clear()
  const html = renderToStaticMarkup(<InterviewControls runId="run" attemptId="attempt" segmentId="segment"
    status={status} ready blocked={false} recorder={() => null} changed={vi.fn(async () => {})} preparing={vi.fn()}
    pause={vi.fn()} leave={vi.fn()} incomplete={vi.fn()} discard={vi.fn()} reconnect={vi.fn()} operationChanged={vi.fn()} conversation={conversation} />)
  h.effects.forEach(effect => effect())
  return html
}
function control(type: string, text?: string, extra: Record<string, string> = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify({ type, text, ...extra }))
  h.listeners.get(RoomEvent.DataReceived)?.forEach(listener => listener(bytes, participant, undefined, 'lk.control'))
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
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
  it('offers saving only the confirmed speech after a transcript stays pending, never automatically', async () => {
    render(); control('session_state', 'ready'); render(); render()
    h.rpc.mockResolvedValueOnce(JSON.stringify({ error: 'TRANSCRIPT_PENDING' }))
    h.buttons.get('Finish answer')!.onClick(); await flush(); await flush()
    const html = render()
    expect(html).toContain('Some speech could not be confirmed')
    expect(h.buttons.has('Save confirmed speech only')).toBe(true)
    h.rpc.mockResolvedValueOnce(JSON.stringify({ error: 'SAVE_FAILED' }))
    h.buttons.get('Save confirmed speech only')!.onClick(); await flush()
    expect(JSON.parse(h.rpc.mock.calls.at(-1)![0].payload)).toMatchObject({ action: 'FINISH', acceptUnresolved: true })
  })
  it('still mutes and locks the microphone while saving an expired answer', () => {
    render(); control('interview_time_up'); control('session_state', 'ready'); render(); render()
    h.rpc.mockImplementation(() => new Promise(() => {}))
    h.buttons.get('Finish answer')!.onClick(); render(); render()
    expect(h.track.enabled).toBe(false)
    expect(h.buttons.get('Mute')?.disabled).toBe(true)
    expect(render()).toContain('Saving and confirming your speech')
  })
})
describe('conversation practices', () => {
  const ready = () => { render('ASKED', true); control('session_state', 'ready'); render('ASKED', true) }
  it('opens the microphone only while the interviewer is listening and shows its state', () => {
    ready(); control('interview_state', undefined, { state: 'asking' }); render('ASKED', true); render('ASKED', true)
    expect(h.track.enabled).toBe(false)
    expect(render('ASKED', true)).toContain('reading the question')
    control('interview_state', undefined, { state: 'listening' }); render('ASKED', true); render('ASKED', true)
    expect(h.track.enabled).toBe(true)
    expect(render('ASKED', true)).toContain('stay quiet for about 5 seconds')
    control('interview_state', undefined, { state: 'confirming' }); render('ASKED', true); render('ASKED', true)
    expect(h.track.enabled).toBe(false)
    expect(h.buttons.get('Finish answer')?.disabled).toBe(true)
  })
  it('sends Finish and Skip to the interviewer naming the current answer; no manual finish call', async () => {
    ready(); control('interview_state', undefined, { state: 'listening' }); render('ASKED', true)
    h.rpc.mockResolvedValue(JSON.stringify({ completed: true }))
    h.buttons.get('Finish answer')!.onClick(); await flush()
    expect(JSON.parse(h.rpc.mock.calls[0][0].payload)).toMatchObject({ action: 'FINISH', attemptId: 'attempt' })
    render('ASKED', true)
    h.buttons.get('Skip question')!.onClick(); await flush()
    expect(JSON.parse(h.rpc.mock.calls[1][0].payload)).toMatchObject({ action: 'SKIP', attemptId: 'attempt' })
  })
  it('offers Next question only when progression stopped for a reason other than a practice limit', () => {
    ready(); control('interview_state', undefined, { state: 'waiting', reason: 'PRACTICE_DURATION_REACHED' }); render('ANSWERED', true)
    expect(h.buttons.has('Next question')).toBe(false)
    expect(render('ANSWERED', true)).toContain('no more questions')
    control('interview_state', undefined, { state: 'waiting', reason: 'QUESTION_UNAVAILABLE' }); render('ANSWERED', true)
    expect(h.buttons.has('Next question')).toBe(true)
  })
  it('More time holds automatic finish and Repeat asks the interviewer to re-read', async () => {
    ready(); control('interview_state', undefined, { state: 'listening' }); render('ASKED', true)
    h.rpc.mockResolvedValue(JSON.stringify({ hold: true }))
    h.buttons.get('More time')!.onClick(); await flush()
    expect(JSON.parse(h.rpc.mock.calls[0][0].payload).action).toBe('HOLD')
    // The page shows the hold the interviewer publishes, not a local guess.
    expect(render('ASKED', true)).not.toContain('Automatic finish is off')
    control('interview_state', undefined, { state: 'listening', hold: '1' }); render('ASKED', true)
    expect(render('ASKED', true)).toContain('Automatic finish is off')
    h.buttons.get('Repeat question')!.onClick(); await flush()
    expect(JSON.parse(h.rpc.mock.calls[1][0].payload).action).toBe('REPEAT')
  })
  it('retries a failed Pause as Pause, never as Finish', async () => {
    ready(); control('interview_state', undefined, { state: 'listening', attemptId: 'attempt' }); render('ASKED', true)
    h.rpc.mockResolvedValueOnce(JSON.stringify({ error: 'TRANSCRIPT_PENDING' }))
    h.buttons.get('Pause')!.onClick(); await flush(); await flush(); render('ASKED', true)
    h.rpc.mockResolvedValueOnce(JSON.stringify({ error: 'TRANSCRIPT_PENDING' }))
    h.buttons.get('Retry saving speech')!.onClick(); await flush(); await flush()
    expect(JSON.parse(h.rpc.mock.calls.at(-1)![0].payload).action).toBe('PAUSE')
    render('ASKED', true)
    h.rpc.mockResolvedValueOnce(JSON.stringify({ error: 'SAVE_FAILED' }))
    h.buttons.get('Save confirmed speech only')!.onClick(); await flush()
    expect(JSON.parse(h.rpc.mock.calls.at(-1)![0].payload)).toMatchObject({ action: 'PAUSE', acceptUnresolved: true })
  })
  it('keeps a failed Finish aimed at its own answer and clears it once the interviewer moves on', async () => {
    ready(); control('interview_state', undefined, { state: 'listening', attemptId: 'attempt' }); render('ASKED', true)
    h.rpc.mockResolvedValueOnce(JSON.stringify({ error: 'TRANSCRIPT_PENDING' }))
    h.buttons.get('Finish answer')!.onClick(); await flush(); await flush()
    expect(render('ASKED', true)).toContain('Some speech could not be confirmed')
    h.rpc.mockResolvedValueOnce(JSON.stringify({ stale: true }))
    h.buttons.get('Retry saving speech')!.onClick(); await flush()
    expect(JSON.parse(h.rpc.mock.calls.at(-1)![0].payload)).toMatchObject({ action: 'FINISH', attemptId: 'attempt' })
    h.rpc.mockResolvedValueOnce(JSON.stringify({ error: 'TRANSCRIPT_PENDING' }))
    h.buttons.get('Finish answer')?.onClick(); await flush(); await flush(); render('ASKED', true)
    control('interview_state', undefined, { state: 'listening', attemptId: 'next-attempt' }); render('ASKED', true); render('ASKED', true)
    expect(render('ASKED', true)).not.toContain('Some speech could not be confirmed')
  })
  it('opens the microphone as soon as the interviewer listens, before the saved status refreshes', () => {
    ready(); control('interview_state', undefined, { state: 'listening', attemptId: 'next-attempt' }); render('PREPARED', true); render('PREPARED', true)
    expect(h.track.enabled).toBe(true)
    expect(h.buttons.get('Finish answer')?.disabled).toBe(false)
  })
  it('a Finish with nothing said keeps the answer open with a notice instead of an error', async () => {
    ready(); control('interview_state', undefined, { state: 'listening', attemptId: 'attempt' }); render('ASKED', true)
    h.rpc.mockResolvedValueOnce(JSON.stringify({ error: 'NO_SPEECH' }))
    h.buttons.get('Finish answer')!.onClick(); await flush(); await flush()
    const html = render('ASKED', true); render('ASKED', true)
    expect(html).toContain('No answer has been heard')
    expect(html).not.toContain('role="alert"')
    expect(h.track.enabled).toBe(true)
  })
  it('does not announce thinking pauses to screen readers', () => {
    ready(); control('interview_state', undefined, { state: 'candidate_end', attemptId: 'attempt' }); render('ASKED', true)
    const html = render('ASKED', true)
    const live = /aria-live="polite">([^<]*)</.exec(html)![1]
    expect(live).not.toContain('Pause noticed')
    expect(html).toContain('Pause noticed')
  })
  it('keeps an explicit Mute through Repeat and a new question, and Unmute respects interviewer gating', async () => {
    ready(); control('interview_state', undefined, { state: 'listening', attemptId: 'attempt' }); render('ASKED', true); render('ASKED', true)
    expect(h.track.enabled).toBe(true)
    h.rpc.mockResolvedValue(JSON.stringify({ hold: true }))
    h.buttons.get('Mute')!.onClick(); render('ASKED', true); render('ASKED', true)
    expect(h.track.enabled).toBe(false)
    // Repeat: the interviewer reads the question, then returns to listening. The learner's mute stands.
    control('interview_state', undefined, { state: 'asking', attemptId: 'attempt' }); render('ASKED', true); render('ASKED', true)
    control('interview_state', undefined, { state: 'listening', attemptId: 'attempt' }); render('ASKED', true); render('ASKED', true)
    expect(h.track.enabled).toBe(false)
    expect(h.buttons.has('Unmute')).toBe(true)
    // A new question and a reconnect-style refresh do not override it either.
    control('interview_state', undefined, { state: 'listening', attemptId: 'next' }); render('PREPARED', true); render('ASKED', true)
    expect(h.track.enabled).toBe(false)
    // Unmute while the interviewer is not listening stays closed until it listens again.
    control('interview_state', undefined, { state: 'asking', attemptId: 'next' }); render('ASKED', true); render('ASKED', true)
    h.buttons.get('Unmute')!.onClick(); render('ASKED', true); render('ASKED', true)
    expect(h.track.enabled).toBe(false)
    control('interview_state', undefined, { state: 'listening', attemptId: 'next' }); render('ASKED', true); render('ASKED', true)
    expect(h.track.enabled).toBe(true)
  })
  it('keeps an explicit Mute in manual practices after the answer is saved and the next question opens', () => {
    render(); control('session_state', 'ready'); render(); render()
    h.buttons.get('Mute')!.onClick(); render(); render()
    expect(h.track.enabled).toBe(false)
    render('ANSWERED'); render('ASKED'); render('ASKED')
    expect(h.track.enabled).toBe(false)
    h.buttons.get('Unmute')!.onClick(); render(); render()
    expect(h.track.enabled).toBe(true)
  })
  it('keeps manual practices on their own Next question control', () => {
    render('ANSWERED'); control('session_state', 'ready'); render('ANSWERED')
    expect(h.buttons.has('Next question')).toBe(true)
    expect(h.buttons.has('More time')).toBe(false)
  })
})
