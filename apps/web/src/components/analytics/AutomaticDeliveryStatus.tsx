import { useEffect, useState } from 'react'
import { getAuthHeaders } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  EMPTY_ELEVATE_DELIVERY_STATUS,
  elevateDeliveryStatusLabel,
  watchElevateDeliveryStatus,
  type ElevateDeliveryStatus,
} from '@/lib/elevateDeliveryStatus'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

/** Independent of manual Reprocess permissions; persists across results tabs. */
export function AutomaticDeliveryStatus({ sessionId }: { sessionId: string }) {
  const [result, setResult] = useState<{ sessionId: string; status: ElevateDeliveryStatus } | null>(null)
  useEffect(() => {
    setResult(null)
    return watchElevateDeliveryStatus(
      (signal) => fetch(`${API_BASE_URL}/sessions/${sessionId}/metrics`, {
        headers: getAuthHeaders(), signal,
      }),
      (status) => setResult({ sessionId, status }),
    )
  }, [sessionId])

  return <AutomaticDeliveryStatusView
    status={result?.sessionId === sessionId ? result.status : EMPTY_ELEVATE_DELIVERY_STATUS}
    onRefresh={() => window.location.reload()}
  />
}

export function AutomaticDeliveryStatusView({
  status, onRefresh,
}: { status: ElevateDeliveryStatus; onRefresh: () => void }) {
  const label = elevateDeliveryStatusLabel(status)
  if (!label) return null
  const canRefresh = status.ready || status.timedOut || status.requestError === 'unavailable'
  return <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
    <span>{label}</span>
    {canRefresh && <Button size="sm" variant="outline" onClick={onRefresh}>
      {status.ready ? 'View updated results' : 'Refresh status'}
    </Button>}
  </div>
}
