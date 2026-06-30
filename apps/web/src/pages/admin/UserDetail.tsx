import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { useConfirm } from '@/hooks/useConfirm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GenderSelect, type ProfileGender } from '@/components/auth/ProfileDetailsRow'
import { Loader2 } from 'lucide-react'

interface UserDetailData {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  avatar: string | null
  phone: string | null
  dateOfBirth: string | null
  gender: string | null
  pincode: string | null
  city: string | null
  state: string | null
  country: string | null
  role: string
  emailVerified: boolean
  lastLoginAt: string | null
  lastActiveAt: string | null
  loginCount: number
  createdAt: string
  updatedAt: string
  hideTranscriptText: boolean
  hideTranscriptJsonExport: boolean
  hideAudioDownload: boolean
  enableTxtExport: boolean
  enableJsonExport: boolean
  enableAudioExport: boolean
  enableReprocess: boolean
  enablePro: boolean
  enableUltra: boolean
  _count: { sessions: number; replaySessions: number; featureUsage: number }
}

interface Activity {
  id: string
  action: string
  resource: string | null
  ipAddress: string | null
  timestamp: string
}

export function UserDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [user, setUser] = useState<UserDetailData | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [savingFlags, setSavingFlags] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    dateOfBirth: '',
    gender: '' as ProfileGender,
    pincode: '',
  })

  useEffect(() => {
    if (!id) return

    Promise.all([
      apiClient<{ user: UserDetailData }>(`/api/admin/users/${id}`),
      apiClient<{ activities: Activity[] }>(`/api/admin/users/${id}/activity`),
    ])
      .then(([userData, activityData]) => {
        setUser(userData.user)
        setActivities(activityData.activities)
        const u = userData.user
        setProfileForm({
          firstName: u.firstName || '',
          lastName: u.lastName || '',
          phone: u.phone || '',
          dateOfBirth: u.dateOfBirth ? new Date(u.dateOfBirth).toISOString().slice(0, 10) : '',
          gender: (u.gender === 'MALE' || u.gender === 'FEMALE' ? u.gender : '') as ProfileGender,
          pincode: u.pincode || '',
        })
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  async function handleChangeRole(newRole: string) {
    if (!id) return
    try {
      const data = await apiClient<{ user: { role: string } }>(`/api/admin/users/${id}/change-role`, {
        method: 'POST',
        body: JSON.stringify({ role: newRole }),
      })
      setUser((prev) => prev ? { ...prev, role: data.user.role } : null)
    } catch (err) {
      console.error('Failed to change role:', err)
    }
  }

  async function updateExportFlag(
    key:
      | 'hideTranscriptText'
      | 'hideTranscriptJsonExport'
      | 'hideAudioDownload'
      | 'enableTxtExport'
      | 'enableJsonExport'
      | 'enableAudioExport'
      | 'enableReprocess'
      | 'enablePro'
      | 'enableUltra',
    value: boolean,
  ) {
    if (!id || !user) return
    setSavingFlags(true)
    try {
      const data = await apiClient<{
        user: Pick<
          UserDetailData,
          | 'hideTranscriptText'
          | 'hideTranscriptJsonExport'
          | 'hideAudioDownload'
          | 'enableTxtExport'
          | 'enableJsonExport'
          | 'enableAudioExport'
          | 'enableReprocess'
          | 'enablePro'
          | 'enableUltra'
        >
      }>(`/api/admin/users/${id}/export-flags`, {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      })
      setUser((prev) => prev ? { ...prev, ...data.user } : null)
      toast.success('Export settings updated')
    } catch (err) {
      console.error('Failed to update export flags:', err)
      toast.error('Failed to update export settings')
    } finally {
      setSavingFlags(false)
    }
  }

  async function handleSaveProfile() {
    if (!id || !user) return
    if (!profileForm.gender) {
      toast.error('Please select Male or Female')
      return
    }
    setSavingProfile(true)
    try {
      const data = await apiClient<{ user: UserDetailData }>(`/api/admin/users/${id}/profile`, {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: profileForm.firstName.trim() || null,
          lastName: profileForm.lastName.trim() || null,
          phone: profileForm.phone,
          dateOfBirth: profileForm.dateOfBirth,
          gender: profileForm.gender,
          pincode: profileForm.pincode,
        }),
      })
      setUser((prev) => (prev ? { ...prev, ...data.user } : null))
      setEditingProfile(false)
      toast.success('Profile updated')
    } catch (err) {
      console.error('Failed to update profile:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleDelete() {
    if (!id) return
    const ok = await confirm({ title: 'Delete User', description: 'Are you sure you want to delete this user? This cannot be undone.', confirmLabel: 'Delete', variant: 'destructive' })
    if (!ok) return
    try {
      await apiClient(`/api/admin/users/${id}`, { method: 'DELETE' })
      toast.success('User deleted')
      navigate('/admin/users')
    } catch (err) {
      console.error('Failed to delete user:', err)
      toast.error('Failed to delete user.')
    }
  }

  if (loading) {
    return <div className="animate-pulse text-muted-foreground">Loading user details...</div>
  }

  if (!user) {
    return <div className="text-muted-foreground">User not found.</div>
  }

  const displayName = user.firstName || user.lastName
    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
    : user.email

  const genderLabel: Record<string, string> = {
    MALE: 'Male',
    FEMALE: 'Female',
    OTHER: 'Other',
    PREFER_NOT_TO_SAY: 'Prefer not to say',
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/admin/users" className="text-sm text-muted-foreground hover:text-foreground">
            &larr; Back to Users
          </Link>
          <h1 className="text-2xl font-bold tracking-tight mt-1">{displayName}</h1>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="text-destructive" onClick={handleDelete}>
            Delete User
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Role</span>
              <Badge variant={user.role === 'SUPER_ADMIN' ? 'destructive' : user.role === 'ADMIN' ? 'default' : 'secondary'}>
                {user.role}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Verified</span>
              <span>{user.emailVerified ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Joined</span>
              <span>{new Date(user.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Login Count</span>
              <span>{user.loginCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Login</span>
              <span>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="text-base">Contact & location</CardTitle>
              <CardDescription className="text-xs mt-1">
                Signup details — editable by admin
              </CardDescription>
            </div>
            {!editingProfile ? (
              <Button variant="outline" size="sm" onClick={() => setEditingProfile(true)}>
                Edit
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={savingProfile}
                  onClick={() => {
                    setEditingProfile(false)
                    setProfileForm({
                      firstName: user.firstName || '',
                      lastName: user.lastName || '',
                      phone: user.phone || '',
                      dateOfBirth: user.dateOfBirth
                        ? new Date(user.dateOfBirth).toISOString().slice(0, 10)
                        : '',
                      gender: (user.gender === 'MALE' || user.gender === 'FEMALE'
                        ? user.gender
                        : '') as ProfileGender,
                      pincode: user.pincode || '',
                    })
                  }}
                >
                  Cancel
                </Button>
                <Button size="sm" disabled={savingProfile} onClick={handleSaveProfile}>
                  {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {editingProfile ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="admin-firstName">First name</Label>
                    <Input
                      id="admin-firstName"
                      value={profileForm.firstName}
                      onChange={(e) => setProfileForm((p) => ({ ...p, firstName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="admin-lastName">Last name</Label>
                    <Input
                      id="admin-lastName"
                      value={profileForm.lastName}
                      onChange={(e) => setProfileForm((p) => ({ ...p, lastName: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-phone">Phone</Label>
                  <Input
                    id="admin-phone"
                    type="tel"
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="admin-dob">Date of birth</Label>
                    <Input
                      id="admin-dob"
                      type="date"
                      value={profileForm.dateOfBirth}
                      onChange={(e) => setProfileForm((p) => ({ ...p, dateOfBirth: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="admin-pincode">Pincode</Label>
                    <Input
                      id="admin-pincode"
                      value={profileForm.pincode}
                      onChange={(e) =>
                        setProfileForm((p) => ({ ...p, pincode: e.target.value.toUpperCase() }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Gender</Label>
                  <GenderSelect
                    value={profileForm.gender}
                    onChange={(g) => setProfileForm((p) => ({ ...p, gender: g }))}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Name</span>
                  <span className="text-right">{displayName}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Phone</span>
                  <span className="text-right">{user.phone || '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Date of birth</span>
                  <span className="text-right">
                    {user.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString() : '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Gender</span>
                  <span className="text-right">
                    {user.gender ? genderLabel[user.gender] || user.gender : '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Pincode</span>
                  <span className="text-right">{user.pincode || '—'}</span>
                </div>
              </>
            )}
            <div className="border-t pt-2 mt-2 space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Resolved (admin only)</p>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">City</span>
                <span className="text-right">{user.city || '—'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">State</span>
                <span className="text-right">{user.state || '—'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Country</span>
                <span className="text-right">{user.country || '—'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Elevate Sessions</span>
              <span className="font-medium">{user._count.sessions}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Replay Sessions</span>
              <span className="font-medium">{user._count.replaySessions}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Feature Usage Events</span>
              <span className="font-medium">{user._count.featureUsage}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscription plans</CardTitle>
            <CardDescription>
              Unlock paid-tier features for this user. Off by default; admins
              always have access regardless of these flags.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border"
                checked={user.enablePro}
                disabled={savingFlags}
                onChange={(e) => updateExportFlag('enablePro', e.target.checked)}
              />
              <span>
                <span className="font-medium">Enable Pro features</span>
                <span className="block text-xs text-muted-foreground">
                  Playback “Key Moments” and the “Ask AI Coach” assistant.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border"
                checked={user.enableUltra}
                disabled={savingFlags}
                onChange={(e) => updateExportFlag('enableUltra', e.target.checked)}
              />
              <span>
                <span className="font-medium">Enable Ultra features</span>
                <span className="block text-xs text-muted-foreground">
                  Replay video-file uploads (MP4, MOV, WebM).
                </span>
              </span>
            </label>
            {savingFlags && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Session Analytics actions</CardTitle>
            <CardDescription>
              These buttons are hidden by default. Enable them to let this user
              download exports or reprocess audio.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
              <div className="space-y-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border"
                    checked={user.enableTxtExport}
                    disabled={savingFlags}
                    onChange={(e) => updateExportFlag('enableTxtExport', e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">Enable “Download TXT”</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border"
                    checked={user.enableJsonExport}
                    disabled={savingFlags}
                    onChange={(e) => updateExportFlag('enableJsonExport', e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">Enable “Download JSON”</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border"
                    checked={user.enableAudioExport}
                    disabled={savingFlags}
                    onChange={(e) => updateExportFlag('enableAudioExport', e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">Enable “Download My Audio”</span>
                    <span className="block text-xs text-muted-foreground">
                      Session Analytics download and live Elevate “Record My Audio”.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border"
                    checked={user.enableReprocess}
                    disabled={savingFlags}
                    onChange={(e) => updateExportFlag('enableReprocess', e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">Enable “Reprocess Audio”</span>
                    <span className="block text-xs text-muted-foreground">
                      Elevate “Reprocess All” / “Reprocess Audio” and Replay re-analyze actions.
                    </span>
                  </span>
                </label>
              </div>
            {savingFlags && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-xs text-muted-foreground mb-2">Change role:</div>
            <div className="flex flex-wrap gap-2">
              {['USER', 'ADMIN', 'SUPER_ADMIN'].map((role) => (
                <Button
                  key={role}
                  variant={user.role === role ? 'default' : 'outline'}
                  size="sm"
                  disabled={user.role === role}
                  onClick={() => handleChangeRole(role)}
                >
                  {role}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {activities.slice(0, 20).map((a) => (
                <div key={a.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between text-sm border-b last:border-0 pb-2">
                  <div>
                    <span className="font-medium">{a.action}</span>
                    {a.resource && <span className="text-muted-foreground ml-2">{a.resource}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
