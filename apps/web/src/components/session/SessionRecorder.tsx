import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { ConnectionState, RoomEvent, Track } from 'livekit-client'
import { useAudioRecording } from '@/hooks/useAudioRecording'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'

const UPLOAD_ATTEMPTS = 3
const UPLOAD_ATTEMPT_MS = 12_000
const FINALIZE_MS = 20_000
const MIC_ATTEMPTS = 20

export type AudioCaptureReport = 'uploaded' | 'pending' | 'failed' | 'unavailable'

export type SessionRecorderHandle = {
  finalize: () => Promise<{ ok: boolean; audioCapture: AudioCaptureReport }>
}

interface SessionRecorderProps {
  sessionId: string | null
  /** Skip capture entirely. This is not hideAudioDownload (export/playback). */
  disabled?: boolean
}

function shouldRetryUploadStatus(status: number): boolean {
  if (status >= 500) return true
  return status === 408 || status === 429
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback())
      },
    )
  })
}

/**
 * Auto-captures the user's microphone and uploads it as a SessionRecording.
 * Leave must call finalize() before tearing down LiveKit so /analyze can see
 * the file. Disconnect/unmount remain a safety net only.
 */
export const SessionRecorder = forwardRef<SessionRecorderHandle, SessionRecorderProps>(
  function SessionRecorder({ sessionId, disabled = false }, ref) {
    const room = useRoomContext()
    const { isRecording, startRecording, stopRecording } = useAudioRecording()

    const startedAtRef = useRef<string | null>(null)
    const startMsRef = useRef<number>(0)
    const uploadedRef = useRef(false)
    const startedRef = useRef(false)
    const startOutcomeRef = useRef<'starting' | 'started' | 'unavailable'>('starting')
    const sessionIdRef = useRef(sessionId)
    sessionIdRef.current = sessionId
    const stopRef = useRef(stopRecording)
    stopRef.current = stopRecording
    const isRecordingRef = useRef(isRecording)
    isRecordingRef.current = isRecording

    const micTrack = useCallback(() => {
      const pubs = Array.from(room.localParticipant.trackPublications.values())
      const mic = pubs.find((p) => p.source === Track.Source.Microphone)
      return mic?.track?.mediaStreamTrack
    }, [room])

    const uploadBlob = async (blob: Blob): Promise<boolean> => {
      const id = sessionIdRef.current
      if (!id || uploadedRef.current || !blob || blob.size === 0) return uploadedRef.current
      const durationSec = startMsRef.current ? (Date.now() - startMsRef.current) / 1000 : 0
      const token = localStorage.getItem('spashtai_token')

      for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
        try {
          const form = new FormData()
          form.append('audio', blob, `elevate-${id}.webm`)
          form.append('recordingType', 'user')
          form.append('durationSec', String(Math.round(durationSec)))
          if (startedAtRef.current) form.append('recordingStartedAt', startedAtRef.current)

          const headers: Record<string, string> = {}
          if (token) headers.Authorization = `Bearer ${token}`

          const response = await fetch(`${API_BASE_URL}/sessions/${id}/recording/upload`, {
            method: 'POST',
            headers,
            body: form,
            signal: AbortSignal.timeout(UPLOAD_ATTEMPT_MS),
          })
          if (response.ok) {
            uploadedRef.current = true
            console.log('📤 Session recording uploaded')
            return true
          }
          if (!shouldRetryUploadStatus(response.status)) {
            console.warn('Session recording upload not retryable', response.status)
            return false
          }
          console.warn(`Session recording upload HTTP ${response.status} (attempt ${attempt})`)
        } catch (err) {
          console.warn(`Session recording upload failed (attempt ${attempt}):`, err)
        }
        if (attempt < UPLOAD_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 400 * attempt))
        }
      }
      return false
    }

    const finalizeOnce = async (): Promise<{ ok: boolean; audioCapture: AudioCaptureReport }> => {
      if (disabled) return { ok: false, audioCapture: 'unavailable' }
      if (uploadedRef.current) return { ok: true, audioCapture: 'uploaded' }
      if (!startedRef.current && !isRecordingRef.current) {
        if (micTrack()) {
          startOutcomeRef.current = 'started'
        } else {
          startOutcomeRef.current = 'unavailable'
          return { ok: false, audioCapture: 'unavailable' }
        }
      }
      const blob = isRecordingRef.current ? await stopRef.current() : null
      if (!blob) return { ok: false, audioCapture: 'failed' }
      const ok = await uploadBlob(blob)
      return { ok, audioCapture: ok ? 'uploaded' : 'failed' }
    }

    useImperativeHandle(ref, () => ({
      finalize: () =>
        withTimeout(finalizeOnce(), FINALIZE_MS, () => ({
          ok: false,
          audioCapture:
            startOutcomeRef.current === 'unavailable' ||
            (!startedRef.current && !isRecordingRef.current)
              ? 'unavailable'
              : 'failed',
        })),
    }))

    useEffect(() => {
      if (disabled || !sessionId) return
      if (room.state !== ConnectionState.Connected) return
      if (isRecordingRef.current || startedAtRef.current) return

      let cancelled = false
      let attempts = 0

      const tryStart = () => {
        if (cancelled) return
        const track = micTrack()
        if (track) {
          startedAtRef.current = new Date().toISOString()
          startMsRef.current = Date.now()
          startedRef.current = true
          startOutcomeRef.current = 'started'
          startRecording(new MediaStream([track]))
          console.log('🎙️ Auto session recording started')
          return
        }
        attempts += 1
        if (attempts < MIC_ATTEMPTS) {
          setTimeout(tryStart, 500)
        } else {
          startOutcomeRef.current = 'unavailable'
        }
      }
      tryStart()

      return () => {
        cancelled = true
      }
    }, [room, room.state, sessionId, disabled, startRecording, micTrack])

    useEffect(() => {
      if (disabled) return
      const onDisconnected = async () => {
        if (uploadedRef.current) return
        if (!isRecordingRef.current) return
        const blob = await stopRef.current()
        if (blob) await uploadBlob(blob)
      }
      room.on(RoomEvent.Disconnected, onDisconnected)
      return () => {
        room.off(RoomEvent.Disconnected, onDisconnected)
      }
    }, [room, disabled])

    useEffect(() => {
      return () => {
        if (uploadedRef.current || !isRecordingRef.current) return
        void stopRef.current().then((blob) => {
          if (blob) void uploadBlob(blob)
        })
      }
    }, [])

    return null
  },
)
