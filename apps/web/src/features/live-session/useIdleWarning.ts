import { useCallback, useEffect, useRef, useState } from 'react'
const IDLE_TIMEOUT_MS = 15 * 60 * 1000
const IDLE_WARNING_MS = 14 * 60 * 1000
export function useIdleWarning(joined: boolean, sessionId: string | null) {
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [idleWarning, setIdleWarning] = useState(false)

  const resetIdleTimer = useCallback(() => {
    setIdleWarning(false)
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    if (!joined || !sessionId) return

    warningTimerRef.current = setTimeout(() => {
      setIdleWarning(true)
    }, IDLE_WARNING_MS)

    idleTimerRef.current = setTimeout(() => {
      // Do not auto-pause: disconnecting LiveKit splits recordings and can
      // overwrite persisted turns. Warn only until pause is segmented.
      console.log('💤 Idle timeout — staying connected (pause is disabled)')
    }, IDLE_TIMEOUT_MS)
  }, [joined, sessionId])

  useEffect(() => {
    if (!joined) return
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    const handler = () => resetIdleTimer()
    events.forEach(e => window.addEventListener(e, handler, { passive: true }))
    resetIdleTimer()
    return () => {
      events.forEach(e => window.removeEventListener(e, handler))
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    }
  }, [joined, resetIdleTimer])

  return { idleWarning, resetIdleTimer }
}
