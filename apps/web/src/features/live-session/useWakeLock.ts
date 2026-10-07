import { useEffect, useRef } from 'react'
export function useWakeLock(joined: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  useEffect(() => {
    if (!joined) {
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
      return
    }

    let released = false
    const acquire = async () => {
      try {
        if (!('wakeLock' in navigator)) return
        wakeLockRef.current = await navigator.wakeLock.request('screen')
        wakeLockRef.current.addEventListener('release', () => {
          if (!released) console.log('🔓 Wake lock released by browser')
        })
        console.log('🔒 Screen wake lock acquired — Mac will stay awake')
      } catch {
        console.log('⚠️ Wake lock unavailable (tab may be hidden)')
      }
    }

    acquire()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && joined) acquire()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      released = true
      document.removeEventListener('visibilitychange', handleVisibility)
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [joined])

}
