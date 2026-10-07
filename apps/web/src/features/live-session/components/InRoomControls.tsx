import { useCallback, useEffect, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { ParticipantEvent, Track } from 'livekit-client'
import { useAudioRecording } from '@/hooks/useAudioRecording'
import { pauseAfterSealingRecording } from '@/lib/pauseCapture'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Loader2, Mic, MicOff } from 'lucide-react'
export function InRoomControls({
  sessionId,
  onSealRecording,
  onPauseSession,
  isPausing,
  inputBlocked,
  enableAudioRecord = false,
}: {
  sessionId: string | null
  onSealRecording: () => Promise<void>
  onPauseSession: () => Promise<void>
  isPausing: boolean
  inputBlocked: boolean
  /** Admin-enabled: live “Record My Audio” download during the session. */
  enableAudioRecord?: boolean
}) {
  const room = useRoomContext()
  const { isRecording, startRecording, stopRecording } = useAudioRecording()
  const [micEnabled, setMicEnabled] = useState(
    () => room.localParticipant.isMicrophoneEnabled,
  )
  const [isTogglingMic, setIsTogglingMic] = useState(false)

  useEffect(() => {
    const syncMicState = () => {
      setMicEnabled(room.localParticipant.isMicrophoneEnabled)
    }

    syncMicState()
    room.localParticipant.on(ParticipantEvent.TrackMuted, syncMicState)
    room.localParticipant.on(ParticipantEvent.TrackUnmuted, syncMicState)
    room.localParticipant.on(ParticipantEvent.LocalTrackPublished, syncMicState)
    room.localParticipant.on(ParticipantEvent.LocalTrackUnpublished, syncMicState)

    return () => {
      room.localParticipant.off(ParticipantEvent.TrackMuted, syncMicState)
      room.localParticipant.off(ParticipantEvent.TrackUnmuted, syncMicState)
      room.localParticipant.off(ParticipantEvent.LocalTrackPublished, syncMicState)
      room.localParticipant.off(ParticipantEvent.LocalTrackUnpublished, syncMicState)
    }
  }, [room])

  const toggleMicrophone = useCallback(async () => {
    if (isTogglingMic) return
    setIsTogglingMic(true)
    try {
      await room.localParticipant.setMicrophoneEnabled(!micEnabled)
      setMicEnabled(room.localParticipant.isMicrophoneEnabled)
      toast.success(micEnabled ? 'Microphone muted' : 'Microphone unmuted')
    } catch (error) {
      console.warn('Failed to change microphone state:', error)
      toast.error(micEnabled ? 'Could not mute microphone' : 'Could not unmute microphone')
    } finally {
      setIsTogglingMic(false)
    }
  }, [isTogglingMic, micEnabled, room])

  const requestPause = useCallback(async () => {
    const muted = await pauseAfterSealingRecording({
      sealRecording: onSealRecording,
      muteMicrophone: async () => {
        await room.localParticipant.setMicrophoneEnabled(false)
        setMicEnabled(false)
      },
      settlePause: onPauseSession,
    })
    if (!muted) {
      toast.error('Could not mute the microphone. This recording segment is still being saved.')
    }
  }, [onPauseSession, onSealRecording, room])

  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      const blob = await stopRecording()
      if (!blob) {
        toast.error('No audio captured for download')
        return
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const safeSessionId = sessionId || 'session'
      const filename = `spashtai-user-audio-${safeSessionId}-${timestamp}.webm`
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Audio downloaded. You can now validate WPM in external tools.')
      return
    }

    const publications = Array.from(room.localParticipant.trackPublications.values())
    const micPublication = publications.find((publication) => publication.source === Track.Source.Microphone)
    const mediaStreamTrack = micPublication?.track?.mediaStreamTrack

    if (!mediaStreamTrack) {
      toast.error('Microphone track not ready yet. Please try again in a second.')
      return
    }

    startRecording(new MediaStream([mediaStreamTrack]))
    toast.success('Recording started')
  }, [isRecording, room, sessionId, startRecording, stopRecording])

  return (
    <>
      <Button
        variant="outline"
        onClick={toggleMicrophone}
        disabled={isTogglingMic || inputBlocked}
        aria-pressed={!micEnabled}
        title={
          micEnabled
            ? 'Mute your microphone while keeping the coach active'
            : 'Unmute your microphone'
        }
      >
        {isTogglingMic ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : micEnabled ? (
          <MicOff className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
        {micEnabled ? 'Mute' : 'Unmute'}
      </Button>
      <Button variant="secondary" onClick={requestPause} disabled={inputBlocked}>
        {isPausing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Pause
      </Button>
      {enableAudioRecord && (
        <Button
          variant={isRecording ? 'destructive' : 'outline'}
          onClick={handleToggleRecording}
          disabled={inputBlocked}
        >
          {isRecording ? 'Stop & Download Audio' : 'Record My Audio'}
        </Button>
      )}
    </>
  )
}
