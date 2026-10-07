import { useEffect, useRef } from 'react'
import type { LiveSessionState } from './types'
import type { LiveSessionApi } from './api'

export function scheduleFallbackDispatch(api: LiveSessionApi, binding: Pick<LiveSessionState, 'roomName' | 'sessionId' | 'segmentId'>, accepted: () => void) {
  const timer = setTimeout(async () => {
    try {
      const response = await api.requestAgentDispatch(binding.roomName, binding.sessionId, binding.segmentId)
      if (response.ok) { accepted(); console.log('🛟 Fallback dispatch triggered for room:', binding.roomName) }
    } catch (error) { console.warn('⚠️ Fallback dispatch failed:', error) }
  }, 15000)
  return () => clearTimeout(timer)
}
export function useFallbackDispatch(api: LiveSessionApi, state: LiveSessionState) {
  const attempted = useRef<string | null>(null)
  const { token, url, roomName, sessionId, segmentId, assistantState } = state
  useEffect(() => {
    if (!token || !url || !roomName || assistantState !== 'unknown' || attempted.current === roomName) return
    return scheduleFallbackDispatch(api, { roomName, sessionId, segmentId }, () => { attempted.current = roomName })
  }, [api, token, url, roomName, sessionId, segmentId, assistantState])
}
