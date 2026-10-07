import { useEffect } from 'react'
import { getAuthHeaders } from '@/lib/api-client'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
export function useUnloadTextMetrics(sessionId: string | null) {
  useEffect(() => {
    const handler = () => {
      if (sessionId) {
        fetch(`${API_BASE_URL}/sessions/${sessionId}/calculate-text-metrics`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({}),
          keepalive: true,
        }).catch(() => {})
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [sessionId])

}
