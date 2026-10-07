import { useWakeLock } from './useWakeLock'
import { useIdleWarning } from './useIdleWarning'
import { useUnloadTextMetrics } from './useUnloadTextMetrics'
import { useFallbackDispatch } from './useFallbackDispatch'
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { LiveSessionController } from './controller'
import { liveSessionApi } from './browser'
import type { LiveSessionEffects, LiveSessionState } from './types'
export function useLiveSession(effects: LiveSessionEffects, observedSessionId: string | null) {
  const latest = useRef(effects); latest.current = effects
  // Lazy state guarantees one controller per page instance; useMemo may be recomputed by React.
  const [controller] = useState(() => {
    const proxy = new Proxy({} as LiveSessionEffects, { get: (_target, name: keyof LiveSessionEffects) => latest.current[name] })
    return new LiveSessionController({ api: liveSessionApi, now: () => new Date(), random: () => Math.random(), effects: proxy })
  })
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const setters = useMemo(() => ({
    setAssistantState: (assistantState: LiveSessionState['assistantState']) => controller.patch({ assistantState }),
  }), [controller])
  const joined = Boolean(state.token && state.url)
  useWakeLock(joined)
  const idle = useIdleWarning(joined, observedSessionId)
  useUnloadTextMetrics(observedSessionId)
  useFallbackDispatch(liveSessionApi, state)
  return { controller, ...state, ...setters, ...idle }
}
