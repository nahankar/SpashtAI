import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
export interface InvitationLimits { batchSize: number; hourlyLimit: number | null }
export function InvitationLimitsCard({ limits, busy, onSave }: { limits: InvitationLimits; busy: boolean; onSave: (limits: InvitationLimits) => void }) {
  const [batchSize, setBatchSize] = useState(limits.batchSize)
  const [hourlyLimit, setHourlyLimit] = useState(limits.hourlyLimit ?? 60)
  const [unlimited, setUnlimited] = useState(limits.hourlyLimit === null)
  return <Card><CardHeader><CardTitle className="text-base">Invitation limits</CardTitle><CardDescription>Applies to this tenant. Single invitations, bulk recipients, resends and Owner access emails share its hourly allowance across all senders. Failed email deliveries also count.</CardDescription></CardHeader><CardContent>
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); onSave({ batchSize, hourlyLimit: unlimited ? null : hourlyLimit }) }}>
      <div className="space-y-1.5"><Label htmlFor="invitation-batch-size">Recipients per batch</Label><Input id="invitation-batch-size" type="number" min={1} max={500} required value={batchSize} onChange={e => setBatchSize(Number(e.target.value))} /><p className="text-xs text-muted-foreground">1–500 recipients per batch.</p></div>
      <div className="space-y-2"><Label htmlFor="invitation-hourly-limit">Invitation attempts per hour</Label><Input id="invitation-hourly-limit" type="number" min={1} max={10000} required={!unlimited} disabled={unlimited} value={hourlyLimit} onChange={e => setHourlyLimit(Number(e.target.value))} />
        <div className="flex items-center gap-2"><Checkbox id="invitation-hourly-unlimited" checked={unlimited} onCheckedChange={v => setUnlimited(v === true)} /><Label htmlFor="invitation-hourly-unlimited">No hourly limit</Label></div>
      </div>
      <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Save invitation limits</Button></div>
    </form>
  </CardContent></Card>
}
