import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ProfileDetailsRow, type ProfileGender } from '@/components/auth/ProfileDetailsRow'
import { useAuth } from '@/hooks/useAuth'
import { EnrollmentFields, type EnrollmentField, type EnrollmentResponses } from '../EnrollmentFields'
import { workspaceCall } from '../shell/context'
interface ProfileData {
  revision: string
  profile: { id: string; email: string; firstName: string | null; lastName: string | null; phone: string | null;
    dateOfBirth: string | null; gender: ProfileGender | null; pincode: string | null; city: string | null; state: string | null; country: string | null }
  enrollmentFields: EnrollmentField[]; enrollmentResponses: EnrollmentResponses
}
export function MemberProfileDialog({ memberId, onSaved, disabled }: { memberId: string; onSaved: () => Promise<void>; disabled: boolean }) {
  const [open, setOpen] = useState(false), [data, setData] = useState<ProfileData | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false)
  const { user, fetchCurrentUser } = useAuth()
  const path = `/api/workspaces/current/members/${encodeURIComponent(memberId)}/profile`
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true); setError(''); setData(null)
    workspaceCall<ProfileData>(path).then(value => { if (active) setData(value) })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load profile') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, path])
  function profile<K extends keyof ProfileData['profile']>(key: K, value: ProfileData['profile'][K]) {
    setData(d => d && { ...d, profile: { ...d.profile, [key]: value } })
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!data) return
    setBusy(true); setError('')
    try {
      const p = data.profile
      await workspaceCall(path, 'PATCH', { revision: data.revision, firstName: p.firstName || '', lastName: p.lastName || '',
        phone: p.phone || '', dateOfBirth: p.dateOfBirth || '', gender: p.gender, pincode: p.pincode || '', enrollmentResponses: data.enrollmentResponses })
      if (user?.id === p.id) await fetchCurrentUser()
      await onSaved(); setOpen(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save profile') }
    finally { setBusy(false) }
  }
  return <><Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>Profile</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>User profile</DialogTitle><DialogDescription>Correct signup details and this tenant’s custom answers. Basic profile details apply to this email’s account across workspaces; custom answers change only in this tenant.</DialogDescription></DialogHeader>
      {loading && <p role="status">Loading profile…</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {data && <form onSubmit={save} className="space-y-4"><fieldset disabled={busy} className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor={`profile-email-${memberId}`}>Sign-in email</Label><Input id={`profile-email-${memberId}`} value={data.profile.email} readOnly /><p className="text-xs text-muted-foreground">Email is the login identity and cannot be changed in this form.</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor={`profile-first-${memberId}`}>First name</Label><Input id={`profile-first-${memberId}`} required maxLength={120} value={data.profile.firstName || ''} onChange={e => profile('firstName', e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor={`profile-last-${memberId}`}>Last name</Label><Input id={`profile-last-${memberId}`} maxLength={120} value={data.profile.lastName || ''} onChange={e => profile('lastName', e.target.value)} /></div></div>
        <div className="space-y-1.5"><Label htmlFor={`profile-phone-${memberId}`}>Phone number</Label><Input id={`profile-phone-${memberId}`} required type="tel" maxLength={30} value={data.profile.phone || ''} onChange={e => profile('phone', e.target.value)} /></div>
        <ProfileDetailsRow idPrefix={`member-${memberId}-`} dateOfBirth={data.profile.dateOfBirth || ''} onDateOfBirthChange={value => profile('dateOfBirth', value)} gender={data.profile.gender || ''} onGenderChange={value => profile('gender', value)} pincode={data.profile.pincode || ''} onPincodeChange={value => profile('pincode', value)} />
        <p className="text-xs text-muted-foreground">City, state and country are resolved from the pincode.</p>
        <section className="space-y-3"><h3 className="font-semibold">Custom signup fields</h3>{data.enrollmentFields.length ? <EnrollmentFields fields={data.enrollmentFields} values={data.enrollmentResponses} onChange={values => setData(d => d && { ...d, enrollmentResponses: values })} /> : <p className="text-sm text-muted-foreground">No custom signup fields.</p>}</section>
      </fieldset><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button></DialogFooter></form>}
    </DialogContent></Dialog>
  </>
}
