import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LiveRoomStatus } from './LiveRoomStatus'
vi.mock('@livekit/components-react', () => ({
  useVoiceAssistant: () => ({ state: 'listening', audioTrack: null }),
  BarVisualizer: () => null,
  useConnectionState: () => 'connected',
  useRoomContext: () => ({ remoteParticipants: new Map() }),
}))
describe('room activity status', () => {
  it.each(['Saving answer…', 'Starting next question…', 'Answer saved'])('shows %s instead of the idle SDK listening state', label => {
    const html = renderToStaticMarkup(<LiveRoomStatus override={{label, hint:'Your microphone is muted.'}} isPaused={false} assistantState="ready" />)
    expect(html).toContain(label); expect(html).toContain('Your microphone is muted.')
    expect(html).not.toContain('Listening'); expect(html).not.toContain('Ready')
  })
  it('preserves existing Elevate status when there is no interview activity override', () => {
    const html = renderToStaticMarkup(<LiveRoomStatus isPaused={false} assistantState="ready" />)
    expect(html).toContain('Listening'); expect(html).toContain('Ready')
  })
})
