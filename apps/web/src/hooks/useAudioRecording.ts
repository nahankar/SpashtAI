import { useState, useRef, useCallback } from 'react';

/** Keep audio already buffered after the microphone track has ended. */
export function blobFromRecordingChunks(chunks: Blob[]): Blob | null {
  if (!chunks.some((chunk) => chunk.size > 0)) return null
  return new Blob(chunks, { type: 'audio/webm' })
}

export interface RecordingStopGate {
  reset: () => void
  stop: (
    recorder: MediaRecorder | null,
    chunks: () => Blob[],
    onSettled: (blob: Blob | null) => void,
  ) => Promise<Blob | null>
}

/**
 * MediaRecorder.stop() is asynchronous. Leave can also disconnect/unmount the
 * room before its stop event arrives, so every caller must share one promise.
 * Otherwise a second caller can package only the final WebM header and upload
 * it before the complete recording.
 */
export function createRecordingStopGate(): RecordingStopGate {
  let stopPromise: Promise<Blob | null> | null = null

  return {
    reset() {
      stopPromise = null
    },
    stop(recorder, chunks, onSettled) {
      if (stopPromise) return stopPromise
      stopPromise = new Promise((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          const blob = blobFromRecordingChunks(chunks())
          onSettled(blob)
          resolve(blob)
        }

        if (!recorder || recorder.state === 'inactive') {
          finish()
          return
        }
        recorder.addEventListener('stop', finish, { once: true })
        recorder.stop()
      })
      return stopPromise
    },
  }
}

interface AudioRecordingHook {
  isRecording: boolean;
  startRecording: (stream: MediaStream, onStopped?: () => void) => void;
  stopRecording: () => Promise<Blob | null>;
  audioUrl: string | null;
  error: string | null;
}

export function useAudioRecording(): AudioRecordingHook {
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onStoppedRef = useRef<(() => void) | null>(null);
  const stopGateRef = useRef<RecordingStopGate | null>(null)
  if (!stopGateRef.current) stopGateRef.current = createRecordingStopGate()

  const releaseInput = () => {
    const onStopped = onStoppedRef.current;
    onStoppedRef.current = null;
    onStopped?.();
  };

  const startRecording = useCallback((stream: MediaStream, onStopped?: () => void) => {
    onStoppedRef.current = onStopped ?? null;
    try {
      // Create MediaRecorder with the audio stream
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus' // Use WebM format for better browser support
      });

      chunksRef.current = [];
      stopGateRef.current?.reset()

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(1000); // Collect data every second
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setError(null);
      
      console.log('🎙️ Started audio recording');
    } catch (err) {
      releaseInput();
      const errorMsg = err instanceof Error ? err.message : 'Failed to start recording';
      setError(errorMsg);
      console.error('❌ Recording error:', err);
    }
  }, []);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return stopGateRef.current!.stop(
      mediaRecorderRef.current,
      () => chunksRef.current,
      (blob) => {
        releaseInput();
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        setIsRecording(false);
        if (blob && blob.size > 0) {
          setAudioUrl(URL.createObjectURL(blob));
          console.log('✅ Recording stopped, size:', blob.size, 'bytes');
        }
        if (!blob) console.warn('⚠️ No active recording to stop')
      },
    )
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
    audioUrl,
    error
  };
}
