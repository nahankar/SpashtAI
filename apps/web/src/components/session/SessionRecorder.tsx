import { useEffect, useRef } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { ConnectionState, RoomEvent, Track } from 'livekit-client'
import { useAudioRecording } from '@/hooks/useAudioRecording'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'

interface SessionRecorderProps {
  sessionId: string | null
  /** Skip entirely when the user's account disables audio capture. */
  disabled?: boolean
}

/**
 * Auto-captures the user's microphone for the whole session and uploads it to
 * the server as a streamable SessionRecording on disconnect. This is what makes
 * the conversation-as-replay audio work in dev (where server-side egress is off)
 * and provides the audio source for delivery analysis. The upload carries
 * recordingStartedAt (t0) so per-turn audio offsets align to the recording.
 */
export function SessionRecorder({ sessionId, disabled = false }: SessionRecorderProps) {
  const room = useRoomContext()
  const { isRecording, startRecording, stopRecording } = useAudioRecording()

  const startedAtRef = useRef<string | null>(null)
  const startMsRef = useRef<number>(0)
  const uploadedRef = useRef(false)
  // Keep the latest stop fn in a ref so the unmount cleanup isn't stale.
  const stopRef = useRef(stopRecording)
  stopRef.current = stopRecording
  const isRecordingRef = useRef(isRecording)
  isRecordingRef.current = isRecording

  const upload = useRef(async (blob: Blob) => {
    if (!sessionId || uploadedRef.current || !blob || blob.size === 0) return
    uploadedRef.current = true
    try {
      const durationSec = startMsRef.current ? (Date.now() - startMsRef.current) / 1000 : 0
      const form = new FormData()
      form.append('audio', blob, `elevate-${sessionId}.webm`)
      form.append('recordingType', 'user')
      form.append('durationSec', String(Math.round(durationSec)))
      if (startedAtRef.current) form.append('recordingStartedAt', startedAtRef.current)

      const token = localStorage.getItem('spashtai_token')
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      // NOTE: no `keepalive` — the Fetch spec caps keepalive bodies at 64KB and
      // recordings are multi-MB. A normal fetch() promise keeps running even
      // after this component unmounts, so the upload still completes on leave.
      await fetch(`${API_BASE_URL}/sessions/${sessionId}/recording/upload`, {
        method: 'POST',
        headers,
        body: form,
      })
      console.log('📤 Session recording uploaded')
    } catch (err) {
      console.warn('Session recording upload failed:', err)
    }
  })

  // Start recording once connected and the mic track is available.
  useEffect(() => {
    if (disabled || !sessionId) return
    if (room.state !== ConnectionState.Connected) return
    if (isRecordingRef.current || startedAtRef.current) return

    let cancelled = false
    let attempts = 0

    const tryStart = () => {
      if (cancelled) return
      const pubs = Array.from(room.localParticipant.trackPublications.values())
      const mic = pubs.find((p) => p.source === Track.Source.Microphone)
      const track = (mic?.track as any)?.mediaStreamTrack as MediaStreamTrack | undefined
      if (track) {
        startedAtRef.current = new Date().toISOString()
        startMsRef.current = Date.now()
        startRecording(new MediaStream([track]))
        console.log('🎙️ Auto session recording started')
        return
      }
      attempts += 1
      if (attempts < 20) setTimeout(tryStart, 500)
    }
    tryStart()

    return () => {
      cancelled = true
    }
  }, [room, room.state, sessionId, disabled, startRecording])

  // Upload on disconnect.
  useEffect(() => {
    if (disabled) return
    const onDisconnected = async () => {
      if (!isRecordingRef.current) return
      const blob = await stopRef.current()
      if (blob) await upload.current(blob)
    }
    room.on(RoomEvent.Disconnected, onDisconnected)
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected)
    }
  }, [room, disabled])

  // Final safety net: flush on unmount if we're still recording.
  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        void stopRef.current().then((blob) => {
          if (blob) void upload.current(blob)
        })
      }
    }
  }, [])

  return null
}
