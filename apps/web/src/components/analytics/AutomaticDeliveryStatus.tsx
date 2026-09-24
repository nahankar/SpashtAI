import { useEffect, useState } from 'react'
import { getAuthHeaders } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

/** Independent of manual Reprocess permissions; persists across results tabs. */
export function AutomaticDeliveryStatus({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    let polls = 0
    let wasPending = false
    setState(null)
    setReady(false)
    setTimedOut(false)
    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/metrics`, {
          headers: getAuthHeaders(), signal: controller.signal,
        })
        if (response.status === 401 || response.status === 403 || response.status === 404) return
        if (!response.ok) throw new Error('delivery_status_unavailable')
        const data = await response.json()
        if (controller.signal.aborted) return
        const next = data.deliveryAlignmentStatus ?? null
        setState(next)
        if (['pending', 'processing', 'retry'].includes(next)) {
          wasPending = true
          if (++polls < 120) timer = window.setTimeout(load, 10_000)
          else setTimedOut(true)
        } else if (next === 'completed' && wasPending) setReady(true)
      } catch {
        if (!controller.signal.aborted) {
          if (++polls < 120) timer = window.setTimeout(load, 10_000)
          else setTimedOut(true)
        }
      }
    }
    void load()
    return () => { controller.abort(); if (timer != null) window.clearTimeout(timer) }
  }, [sessionId])

  if (ready) return <div role="status" className="flex items-center gap-2 rounded-md border p-3 text-sm">
    Delivery analysis is ready.
    <Button size="sm" variant="outline" onClick={() => window.location.reload()}>View updated results</Button>
  </div>
  if (state === 'unavailable') return <p role="status" className="text-sm text-muted-foreground">
    Word timing could not be verified for this recording. Playback and other feedback remain available.
  </p>
  if (!state || !['pending', 'processing', 'retry'].includes(state)) return null
  return <p role="status" className="text-sm text-muted-foreground">
    {timedOut ? 'Delivery analysis is continuing in the background. Reopen this session later for updated results.'
      : 'Preparing delivery analysis from your recording. This can take a few minutes; you can leave this page.'}
  </p>
}
