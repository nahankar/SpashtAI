import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Mic, Upload, AlertCircle, BriefcaseBusiness, Timer, Activity } from 'lucide-react'
import { useFeatureFlags } from '@/contexts/FeatureFlagsContext'

interface FeatureFlagRow {
  feature: string
  audience: 'EVERYONE' | 'SELECTED_USERS'
  label: string
  description: string | null
  hidden: boolean
  disabled: boolean
  overlayComment: string | null
  overlayPosition: 'top' | 'center'
  enabled: boolean
  updatedAt: string
}

const FEATURE_ICONS: Record<string, typeof Mic> = {
  elevate: Mic,
  replay: Upload,
  prepare: BriefcaseBusiness,
  quick_try: Timer,
  delivery_moments: Activity,
}

function FlagToggle({
  id,
  label,
  checked,
  onChange,
  disabled,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm cursor-pointer">
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 rounded border"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

export function FeatureFlagsAdmin() {
  const { refresh: refreshPublicFlags } = useFeatureFlags()
  const [flags, setFlags] = useState<FeatureFlagRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Partial<FeatureFlagRow>>>({})

  async function load() {
    setLoading(true)
    try {
      const res = await apiClient<{ flags: FeatureFlagRow[] }>('/api/admin/feature-flags')
      setFlags(res.flags)
      setDrafts({})
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load feature flags')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function getDraft(feature: string, flag: FeatureFlagRow): FeatureFlagRow {
    return { ...flag, ...drafts[feature] }
  }

  function patchDraft(feature: string, patch: Partial<FeatureFlagRow>) {
    setDrafts((prev) => ({ ...prev, [feature]: { ...prev[feature], ...patch } }))
  }

  async function save(feature: string) {
    const flag = flags.find((f) => f.feature === feature)
    if (!flag) return
    const d = getDraft(feature, flag)
    setSaving(feature)
    setError(null)
    try {
      await apiClient(`/api/admin/feature-flags/${feature}`, {
        method: 'PUT',
        body: JSON.stringify({
          hidden: d.hidden,
          disabled: d.disabled,
          audience: d.audience,
          overlayComment: d.overlayComment || null,
          overlayPosition: d.overlayPosition,
        }),
      })
      await load()
      await refreshPublicFlags()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update feature flag')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading feature flags…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
        <p className="text-muted-foreground">
          Control module visibility and controlled analysis capabilities. <strong>Hide</strong> removes a feature from the UI.
          <strong> Disabled</strong> shows it with an overlay but blocks access. Add overlay text like
          &quot;Coming soon&quot; or &quot;Earn points to unlock.&quot;
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {flags.map((flag) => {
          const Icon = FEATURE_ICONS[flag.feature] ?? Mic
          const d = getDraft(flag.feature, flag)
          const isSaving = saving === flag.feature
          const status = d.hidden ? 'Hidden' : d.disabled ? 'Disabled' : 'Active'

          return (
            <Card key={flag.feature}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-md bg-primary/10 p-2 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{flag.label}</CardTitle>
                      <CardDescription className="font-mono text-xs">{flag.feature}</CardDescription>
                    </div>
                  </div>
                  <Badge
                    variant={status === 'Active' ? 'default' : status === 'Disabled' ? 'secondary' : 'outline'}
                  >
                    {status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {flag.description && (
                  <p className="text-sm text-muted-foreground">{flag.description}</p>
                )}

                {flag.feature === 'interviews' && <div className="space-y-1">
                  <Label htmlFor={`${flag.feature}-audience`}>Audience</Label>
                  <select
                    id={`${flag.feature}-audience`}
                    className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={d.audience ?? 'EVERYONE'}
                    onChange={(e) => patchDraft(flag.feature, { audience: e.target.value as 'EVERYONE' | 'SELECTED_USERS' })}
                  >
                    <option value="EVERYONE">Everyone</option>
                    <option value="SELECTED_USERS">Selected users</option>
                  </select>
                </div>}
                {flag.feature === 'interviews' && d.audience === 'SELECTED_USERS' && <PilotGrants feature={flag.feature} />}

                <div className="flex flex-wrap gap-4">
                  <FlagToggle
                    id={`${flag.feature}-hide`}
                    label="Hide"
                    checked={d.hidden}
                    onChange={(hidden) => patchDraft(flag.feature, { hidden })}
                  />
                  <FlagToggle
                    id={`${flag.feature}-disabled`}
                    label="Disabled (visible but blocked)"
                    checked={d.disabled}
                    disabled={d.hidden}
                    onChange={(disabled) => patchDraft(flag.feature, { disabled })}
                  />
                </div>

                {!d.hidden && d.disabled && (
                  <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                    <div className="space-y-1">
                      <Label htmlFor={`${flag.feature}-overlay`}>Overlay comment</Label>
                      <Textarea
                        id={`${flag.feature}-overlay`}
                        rows={2}
                        placeholder="e.g. Coming soon — earn points to unlock for free"
                        value={d.overlayComment ?? ''}
                        onChange={(e) =>
                          patchDraft(flag.feature, { overlayComment: e.target.value || null })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${flag.feature}-pos`}>Overlay position</Label>
                      <select
                        id={`${flag.feature}-pos`}
                        className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                        value={d.overlayPosition}
                        onChange={(e) =>
                          patchDraft(flag.feature, {
                            overlayPosition: e.target.value as 'top' | 'center',
                          })
                        }
                      >
                        <option value="center">Center (over card)</option>
                        <option value="top">Top of card</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Updated {new Date(flag.updatedAt).toLocaleString()}
                  </span>
                  <Button size="sm" disabled={isSaving} onClick={() => save(flag.feature)}>
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…
                      </>
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function PilotGrants({ feature }: { feature: string }) {
  const [users, setUsers] = useState<Array<{ id: string; email: string }>>([])
  const [grantedIds, setGrantedIds] = useState<string[]>([])
  const [grantEmails, setGrantEmails] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => { Promise.all([
      apiClient<{ users: Array<{ id: string; email: string }> }>(`/api/admin/users?limit=100&search=${encodeURIComponent(search)}`),
      apiClient<{ grants: Array<{ userId: string; user: { email: string } }> }>(`/api/admin/feature-flags/${feature}/grants`),
    ]).then(([people, grants]) => {
      if (!cancelled) {
        setUsers(people.users); setGrantedIds(grants.grants.map(g => g.userId))
        setGrantEmails(Object.fromEntries(grants.grants.map(g => [g.userId, g.user.email])))
      }
    }).catch(() => { if (!cancelled) setError('Could not load pilot users') })
    }, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [feature, search])
  async function change(userId: string, granted: boolean) {
    setBusy(true)
    try {
      await apiClient(`/api/admin/feature-flags/${feature}/grants/${encodeURIComponent(userId)}`, {
        method: 'PUT', body: JSON.stringify({ granted }),
      })
      setGrantedIds(ids => granted ? [...new Set([...ids, userId])] : ids.filter(id => id !== userId))
      const email = users.find(u => u.id === userId)?.email
      if (email) setGrantEmails(previous => ({ ...previous, [userId]: email }))
      setSelectedId('')
      setError(null)
    } catch { setError('Could not update pilot access') }
    finally { setBusy(false) }
  }
  return <div className="space-y-2 rounded-md border p-3">
    <p className="text-sm font-medium">Pilot access</p>
    <p className="text-xs text-muted-foreground">Invitations do not override Hide or Disabled. Audience changes take effect when you save the feature.</p>
    <input aria-label="Find pilot user" placeholder="Find a user by email or name" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
    <select aria-label="Select pilot user" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
      <option value="">Select a user</option>
      {users.filter(u => !grantedIds.includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
    </select>
    <Button size="sm" disabled={busy || !selectedId} onClick={() => change(selectedId, true)}>Grant access</Button>
    {grantedIds.map(id => <div key={id} className="flex items-center justify-between gap-2 text-sm">
      <span>{grantEmails[id] ?? users.find(u => u.id === id)?.email ?? id}</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => change(id, false)}>Revoke</Button>
    </div>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
