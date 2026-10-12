import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function BankProvenanceConfirmation({ count, disabled, onConfirm, onCancel }: {
  count: number; disabled: boolean; onConfirm: (note: string) => Promise<void>; onCancel?: () => void
}) {
  const [note, setNote] = useState(''); const [confirmed, setConfirmed] = useState(false)
  return <form className="rounded-xl border p-5 space-y-3" onSubmit={e => { e.preventDefault(); if (confirmed && note.trim().length >= 20 && !disabled) void onConfirm(note.trim()) }}>
    <h2 className="font-semibold">Confirm learning content provenance</h2>
    <p className="text-sm text-muted-foreground">Confirm the current saved content for {count} question{count === 1 ? '' : 's'}. Approval and CSV import alone do not confirm permission to use the material.</p>
    <fieldset disabled={disabled} className="space-y-3">
      <label className="block text-sm space-y-1"><span>Authorship or permission note</span><textarea rows={3} minLength={20} maxLength={2000} required className="w-full rounded-md border bg-background p-2" value={note} onChange={e => setNote(e.target.value)} placeholder="Describe who authored the learning content or the permission that allows its use…" /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>I have reviewed this learning content and confirm it was authored for SpashtAI or is used with permission.</span></label>
      <Button type="submit" disabled={!confirmed || note.trim().length < 20 || count === 0}>Confirm provenance</Button>
      {onCancel && <Button type="button" variant="outline" className="ml-2" onClick={onCancel}>Cancel</Button>}
    </fieldset>
  </form>
}
