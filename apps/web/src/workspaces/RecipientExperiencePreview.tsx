import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ProfileDetailsRow } from '@/components/auth/ProfileDetailsRow'
import { EnrollmentFields, type EnrollmentField } from './EnrollmentFields'

export interface EmailPreview { previewOnly: true; subject: string; text: string; html: string; expiresAt: string }
export interface PreviewProps {
  workspaceName?: string
  fields?: EnrollmentField[]
  emailContent: { subject: string; message: string }
  onEmailPreview: (body: { emailContent: { subject: string; message: string }; name?: string }) => Promise<EmailPreview>
}
export function SignupFieldsPreview({ workspaceName, fields = [] }: { workspaceName?: string; fields?: EnrollmentField[] }) {
  const prefix = `preview-${useId()}-`
  return <div className="space-y-4" aria-label="Recipient signup preview">
    <p className="text-sm">Preview only. These controls cannot submit or change an account.</p>
    <div className="mx-auto max-w-lg rounded-lg border p-5 space-y-4">
      <h3 className="text-lg font-semibold">1. Accept {workspaceName ? `${workspaceName} workspace` : 'your'} invitation</h3>
      <p>Sign in with the Google Account matching the invited email address.</p>
      <fieldset disabled className="space-y-3">
        {fields.length > 0 ? <><h4 className="font-semibold">Workspace details</h4><EnrollmentFields fields={fields} values={{}} onChange={() => {}} /><Button type="button">Continue with these details</Button></> : <p>No additional workspace fields are configured.</p>}
        <Button type="button" variant="outline">Continue with Google</Button>
      </fieldset>
    </div>
    <div className="mx-auto max-w-lg rounded-lg border p-5 space-y-4">
      <h3 className="text-lg font-semibold">2. Almost there</h3>
      <p>Add a few details to finish setting up your account. This step is skipped if your regular profile is already complete.</p>
      <fieldset disabled className="space-y-4">
        <label htmlFor={`${prefix}phone`} className="block">Phone number</label><Input id={`${prefix}phone`} type="tel" placeholder="10-digit mobile number" />
        <ProfileDetailsRow idPrefix={prefix} dateOfBirth="" gender="" pincode="" onDateOfBirthChange={() => {}} onGenderChange={() => {}} onPincodeChange={() => {}} />
        <Button type="button">Continue</Button>
      </fieldset>
    </div>
    {workspaceName && <p>After these steps, the recipient opens {workspaceName}. Workspace responses stay with that workspace; Personal history stays separate.</p>}
  </div>
}
export function RecipientExperiencePreview({ workspaceName, fields, emailContent, onEmailPreview }: PreviewProps) {
  const [tab, setTab] = useState<'email' | 'signup'>('email')
  const [email, setEmail] = useState<EmailPreview | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function load() {
    setBusy(true); setError(''); setEmail(null)
    try { setEmail(await onEmailPreview({ emailContent })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load email preview') }
    finally { setBusy(false) }
  }
  return <details className="rounded-lg border p-4"><summary className="cursor-pointer font-semibold">Preview recipient experience</summary>
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Preview view">
        <Button type="button" variant={tab === 'email' ? 'default' : 'outline'} onClick={() => setTab('email')}>Invitation email</Button>
        <Button type="button" variant={tab === 'signup' ? 'default' : 'outline'} onClick={() => setTab('signup')}>Signup fields</Button>
      </div>
      {tab === 'email' ? <div className="space-y-3">
        <p>Uses the same template as the received email, with a sample recipient and expiry. No email is sent and the acceptance link is inactive.</p>
        <Button type="button" variant="outline" disabled={busy} onClick={load}>{busy ? 'Loading preview…' : 'Generate email preview'}</Button>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {email && <><p className="break-words"><strong>Subject:</strong> {email.subject}</p><iframe title="Invitation email preview" sandbox="" referrerPolicy="no-referrer" srcDoc={email.html} className="w-full h-[620px] rounded border bg-white" /><details><summary>Plain text version</summary><pre className="whitespace-pre-wrap break-words text-sm">{email.text}</pre></details></>}
      </div> : <SignupFieldsPreview workspaceName={workspaceName} fields={fields} />}
    </div>
  </details>
}
