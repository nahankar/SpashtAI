import { RecipientExperiencePreview, type PreviewProps } from '@/workspaces/RecipientExperiencePreview'
import { useState } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
export interface BatchResult { results: Array<{ email: string; ok: boolean; error?: string; invitation?: { deliveryStatus: string } }> }
export function BulkInvitations({ send, emailContent, workspace = false, preview, fields, workspaceName, invitationLimits = { batchSize: 20, hourlyLimit: 60 } }: { invitationLimits?: { batchSize: number; hourlyLimit: number | null }; send: (body: { emails: string[]; emailContent: { subject: string; message: string }; confirmExistingUser?: boolean }) => Promise<BatchResult>; emailContent?: { subject: string; message: string }; workspace?: boolean; preview?: PreviewProps['onEmailPreview']; fields?: PreviewProps['fields']; workspaceName?: string }) {
  const [emails, setEmails] = useState(''), [subject, setSubject] = useState(emailContent?.subject || ''), [message, setMessage] = useState(emailContent?.message || '')
  const [confirm, setConfirm] = useState(false), [existing, setExisting] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [result, setResult] = useState<BatchResult | null>(null)
  const addresses = [...new Set(emails.split(/[\s,;]+/).filter(Boolean).map(s => s.toLowerCase()))]
  async function submit() {
    setBusy(true); setError('')
    try { setResult(await send({ emails: addresses, emailContent: { subject, message }, ...(!workspace ? { confirmExistingUser: existing } : {}) })); setConfirm(false) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to send invitations') }
    finally { setBusy(false) }
  }
  return <Accordion type="single" collapsible className="rounded-lg border px-4"><AccordionItem value="bulk" className="border-b-0"><AccordionTrigger className="font-semibold">Invite multiple users</AccordionTrigger><AccordionContent>
    <form className="space-y-3 pt-3" onChange={() => { setConfirm(false); setResult(null) }} onSubmit={e => { e.preventDefault(); setError(''); if (!addresses.length || addresses.length > invitationLimits.batchSize || addresses.some(a => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))) { setError(`Enter 1–${invitationLimits.batchSize} valid email addresses.`); return }; setConfirm(true) }}>
      <fieldset disabled={busy} className="space-y-3"><div className="space-y-1.5"><Label htmlFor="bulk-emails">Email addresses</Label><Textarea id="bulk-emails" rows={4} required maxLength={invitationLimits.batchSize * 260} value={emails} onChange={e => setEmails(e.target.value)} placeholder="One per line, or separated by commas" /></div>
      <p>{addresses.length} unique recipients. Each gets a separate private invitation. Bulk invitations use the Learner role and default feature permissions.</p>
      <div className="space-y-1.5"><Label htmlFor="bulk-subject">Email subject (optional)</Label><Input id="bulk-subject" maxLength={150} value={subject} onChange={e => setSubject(e.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="bulk-message">Email message</Label><Textarea id="bulk-message" rows={4} maxLength={5000} value={message} onChange={e => setMessage(e.target.value)} placeholder="This is the email body the recipient reads." /></div>
      <p className="text-sm">This message is the email body. SpashtAI only adds the Accept invitation button and the expiry notice. Up to {invitationLimits.batchSize} recipients per batch. {invitationLimits.hourlyLimit === null ? 'No hourly invitation limit.' : `${invitationLimits.hourlyLimit} invitation attempts per hour${workspace ? ' shared across this tenant' : ''}.`}</p>
      {!workspace && <div className="flex items-center gap-2"><Checkbox id="bulk-existing" checked={existing} onCheckedChange={value => { setExisting(value === true); setConfirm(false); setResult(null) }} /><Label htmlFor="bulk-existing">Also send to existing accounts (their data and permissions stay unchanged)</Label></div>}
      {preview && <RecipientExperiencePreview key={JSON.stringify({ subject, message, fields })} workspaceName={workspaceName} fields={fields} emailContent={{ subject, message }} onEmailPreview={preview} />}
      <Button type="submit">Review batch</Button></fieldset>
    </form>
    <AlertDialog open={confirm} onOpenChange={open => { if (!open && !busy) setConfirm(false) }}>
      <AlertDialogContent className="max-h-[90vh] overflow-y-auto"><AlertDialogHeader><AlertDialogTitle>Confirm bulk invitations</AlertDialogTitle>
        <AlertDialogDescription>Send invitation emails to these {addresses.length} recipients? If email delivery fails, their invitations remain saved for resending.</AlertDialogDescription></AlertDialogHeader>
        <ul className="break-all text-sm">{addresses.map(a => <li key={a}>{a}</li>)}</ul><p className="font-semibold">{subject || 'Default invitation subject'}</p><p className="whitespace-pre-wrap text-sm">{message || 'Default invitation message'}</p>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><Button disabled={busy} onClick={submit}>{busy ? 'Processing batch…' : 'Confirm and send invitations'}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {result && <div role="status" className="space-y-2 pt-3"><h3 className="font-semibold">Batch results</h3><ul>{result.results.map(row => <li className="break-all" key={row.email}>{row.email}: {row.ok ? ({ SENT: 'Sent to mail server', DEV_CAPTURED: 'Captured locally; no email sent', FAILED: 'Saved; email not sent. Resend from the list', SENDING: 'Saved; delivery outcome pending. Check before resending' }[row.invitation?.deliveryStatus || ''] || 'Saved') : row.error}</li>)}</ul><p>Successful recipients are already saved. Retry only failed recipients; use Resend for saved invitations.</p></div>}
  </AccordionContent></AccordionItem></Accordion>
}
