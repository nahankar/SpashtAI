import { useEffect } from 'react'
import { useAudioPlayback, useRoomContext } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'

/** Best-effort unlock of remote audio after LiveKit connects (autoplay policy). */
export function CoachAudioBootstrap() {
  const room = useRoomContext()
  const { startAudio } = useAudioPlayback(room)

  useEffect(() => {
    if (room.state !== ConnectionState.Connected) return
    void startAudio().catch(() => {
      /* StartAudio button is the fallback when the browser blocks playback */
    })
  }, [room.state, startAudio])

  return null
}
