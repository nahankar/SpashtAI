import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { ConnectionState, RoomEvent, Track } from 'livekit-client'
import { useAudioRecording } from '@/hooks/useAudioRecording'
import { describeAudioCapture } from '@/lib/audioCapture'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'

const UPLOAD_ATTEMPTS = 3
const UPLOAD_ATTEMPT_MS = 12_000
// Three 12s upload attempts plus bounded backoff. A terminal Pause/Leave result
// must not be reported while the final retry can still succeed.
const FINALIZE_MS = 42_000
const MIC_ATTEMPTS = 20

export type AudioCaptureReport = 'uploaded' | 'pending' | 'failed' | 'unavailable'

export type SessionRecorderHandle = {
  finalize: () => Promise<{ ok: boolean; audioCapture: AudioCaptureReport }>
  waitForFinalization: () => Promise<{ ok: boolean; audioCapture: AudioCaptureReport }>
  retryUpload: () => Promise<{ ok: boolean; audioCapture: AudioCaptureReport }>
}

interface SessionRecorderProps {
  sessionId: string | null
  segmentId: string | null
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
  function SessionRecorder({ sessionId, segmentId, disabled = false }, ref) {
    const room = useRoomContext()
    const { isRecording, startRecording, stopRecording } = useAudioRecording()

    const startedAtRef = useRef<string | null>(null)
    const startMsRef = useRef<number>(0)
    const durationSecRef = useRef<number>(0)
    const uploadedRef = useRef(false)
    const capturedBlobRef = useRef<Blob | null>(null)
    const finalizePromiseRef = useRef<Promise<{
      ok: boolean
      audioCapture: AudioCaptureReport
    }> | null>(null)
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

    const uploadBlob = useCallback(async (blob: Blob): Promise<boolean> => {
      const id = sessionIdRef.current
      if (!id || !segmentId || uploadedRef.current || !blob || blob.size === 0) {
        return uploadedRef.current
      }
      const durationSec =
        durationSecRef.current ||
        (startMsRef.current ? (Date.now() - startMsRef.current) / 1000 : 0)
      const token = localStorage.getItem('spashtai_token')

      for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
        try {
          const form = new FormData()
          form.append('audio', blob, `elevate-${id}.webm`)
          form.append('recordingType', 'user')
          form.append('segmentId', segmentId)
          form.append('durationSec', String(durationSec))
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
    }, [segmentId])

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
      const blob = capturedBlobRef.current ??
        (isRecordingRef.current ? await stopRef.current() : null)
      if (!blob) return { ok: false, audioCapture: 'failed' }
      if (!capturedBlobRef.current && startMsRef.current) {
        durationSecRef.current = (Date.now() - startMsRef.current) / 1000
      }
      capturedBlobRef.current = blob
      const ok = await uploadBlob(blob)
      return { ok, audioCapture: ok ? 'uploaded' : 'failed' }
    }

    useImperativeHandle(ref, () => ({
      finalize: () => {
        if (!finalizePromiseRef.current) {
          finalizePromiseRef.current = finalizeOnce()
        }
        return withTimeout(finalizePromiseRef.current, FINALIZE_MS, () => ({
          ok: false,
          audioCapture:
            startOutcomeRef.current === 'unavailable' ||
            (!startedRef.current && !isRecordingRef.current)
              ? 'unavailable'
              : 'pending',
        }))
      },
      waitForFinalization: async () => {
        if (!finalizePromiseRef.current) {
          finalizePromiseRef.current = finalizeOnce()
        }
        try {
          return await finalizePromiseRef.current
        } catch (error) {
          console.warn('Session recording finalization failed:', error)
          return { ok: false, audioCapture: 'failed' }
        }
      },
      retryUpload: async () => {
        const blob = capturedBlobRef.current
        if (!blob) return { ok: false, audioCapture: 'unavailable' }
        // Each fetch attempt already has a bounded timeout. Keep the caller in
        // the saving state until the retry is terminal so practice cannot
        // resume while MediaRecorder is stopped.
        const ok = await uploadBlob(blob)
        return {
          ok,
          audioCapture: ok ? 'uploaded' : 'failed',
        }
      },
    }))

    useEffect(() => {
      if (disabled || !sessionId || !segmentId) return
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
          console.log('🎙️ Auto session recording started', describeAudioCapture(track))
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
    }, [room, room.state, sessionId, segmentId, disabled, startRecording, micTrack])

    useEffect(() => {
      if (disabled) return
      const onDisconnected = async () => {
        if (uploadedRef.current) return
        if (!isRecordingRef.current) return
        const blob = await stopRef.current()
        if (blob) {
          if (startMsRef.current) {
            durationSecRef.current = (Date.now() - startMsRef.current) / 1000
          }
          capturedBlobRef.current = blob
          await uploadBlob(blob)
        }
      }
      room.on(RoomEvent.Disconnected, onDisconnected)
      return () => {
        room.off(RoomEvent.Disconnected, onDisconnected)
      }
    }, [room, disabled, uploadBlob])

    useEffect(() => {
      return () => {
        if (uploadedRef.current || !isRecordingRef.current) return
        void stopRef.current().then((blob) => {
          if (blob) {
            if (startMsRef.current) {
              durationSecRef.current = (Date.now() - startMsRef.current) / 1000
            }
            capturedBlobRef.current = blob
            void uploadBlob(blob)
          }
        })
      }
    }, [uploadBlob])

    return null
  },
)
