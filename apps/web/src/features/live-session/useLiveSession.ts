import { useMemo, useRef, useSyncExternalStore } from 'react'
import { LiveSessionController } from './controller'
import { liveSessionApi } from './browser'
import type { LiveSessionEffects, LiveSessionState } from './types'
export function useLiveSession(effects: LiveSessionEffects) {
  const latest = useRef(effects); latest.current = effects
  const [controller] = useMemo(() => {
    const proxy = new Proxy({} as LiveSessionEffects, { get: (_target, name: keyof LiveSessionEffects) => latest.current[name] })
    return [new LiveSessionController({ api: liveSessionApi, now: () => new Date(), random: () => Math.random(), effects: proxy })]
  }, [])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const setters = useMemo(() => {
    const setter = <K extends keyof LiveSessionState>(key: K) => (value: LiveSessionState[K]) => controller.patch({ [key]: value })
    return { setToken: setter('token'), setUrl: setter('url'), setRoomName: setter('roomName'), setSegmentId: setter('segmentId'),
      setIsJoining: setter('isJoining'), setIsLeaving: setter('isLeaving'), setIsPausing: setter('isPausing'),
      setIsResuming: setter('isResuming'), setAssistantState: setter('assistantState'), setIsSessionPaused: setter('isSessionPaused'),
      setPauseReason: setter('pauseReason'), setPauseAudioFailure: setter('pauseAudioFailure') }
  }, [controller])
  return { controller, ...state, ...setters }
}
