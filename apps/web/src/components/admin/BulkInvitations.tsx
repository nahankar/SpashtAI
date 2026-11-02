import { useState } from 'react'
import { Button } from '@/components/ui/button'
export interface BatchResult { results: Array<{ email: string; ok: boolean; error?: string; invitation?: { deliveryStatus: string } }> }
const inputClass = 'w-full min-w-0 rounded border px-3 py-2 bg-background'
export function BulkInvitations({ send, emailContent, workspace = false }: { send: (body: { emails: string[]; emailContent: { subject: string; message: string }; confirmExistingUser?: boolean }) => Promise<BatchResult>; emailContent?: { subject: string; message: string }; workspace?: boolean }) {
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
  return <details className="rounded-lg border p-4"><summary className="cursor-pointer font-semibold">Invite multiple users</summary>
    <form className="space-y-3 pt-3" onChange={() => { setConfirm(false); setResult(null) }} onSubmit={e => { e.preventDefault(); setError(''); if (!addresses.length || addresses.length > 20 || addresses.some(a => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))) { setError('Enter 1–20 valid email addresses.'); return }; setConfirm(true) }}>
      <fieldset disabled={busy} className="space-y-3"><label className="block">Email addresses<textarea className={inputClass} rows={4} required maxLength={5200} value={emails} onChange={e => setEmails(e.target.value)} placeholder="One per line, or separated by commas" /></label>
      <p>{addresses.length} unique recipients. Each gets a separate private invitation. All addresses must have Google Accounts. Bulk invitations use the Learner role and default feature permissions.</p>
      <label className="block">Email subject (optional)<input className={inputClass} maxLength={150} value={subject} onChange={e => setSubject(e.target.value)} /></label>
      <label className="block">Email message (optional)<textarea className={inputClass} rows={4} maxLength={5000} value={message} onChange={e => setMessage(e.target.value)} /></label>
      <p className="text-sm">The acceptance link, expiry and sign-in instructions are always included. Up to 20 recipients per batch and 60 invitation attempts per hour.</p>
      {!workspace && <label className="flex gap-2"><input type="checkbox" checked={existing} onChange={e => setExisting(e.target.checked)} />Also send to existing accounts (their data and permissions stay unchanged)</label>}
      <Button type="submit">Review batch</Button></fieldset>
    </form>
    {confirm && <div className="rounded border p-3 my-3 space-y-3" role="dialog" aria-label="Confirm bulk invitations"><p>Send invitation emails to these {addresses.length} recipients? If email delivery fails, their invitations remain saved for resending.</p><ul className="break-all">{addresses.map(a => <li key={a}>{a}</li>)}</ul><p className="font-semibold">{subject || 'Default invitation subject'}</p><p className="whitespace-pre-wrap">{message || 'Default invitation message'}</p><Button disabled={busy} onClick={submit}>{busy ? 'Processing batch…' : 'Confirm and send invitations'}</Button><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button></div>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {result && <div role="status" className="space-y-2 pt-3"><h3 className="font-semibold">Batch results</h3><ul>{result.results.map(row => <li className="break-all" key={row.email}>{row.email}: {row.ok ? ({ SENT: 'Sent to mail server', DEV_CAPTURED: 'Captured locally; no email sent', FAILED: 'Saved; email not sent. Resend from the list', SENDING: 'Saved; delivery outcome pending. Check before resending' }[row.invitation?.deliveryStatus || ''] || 'Saved') : row.error}</li>)}</ul><p>Successful recipients are already saved. Retry only failed recipients; use Resend for saved invitations.</p></div>}
  </details>
}
