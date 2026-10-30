import { useCallback, useEffect, useState } from 'react'
import { MailPlus, Inbox, TriangleAlert, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InvitationTable } from '@/components/admin/InvitationTable'
import { InviteUserDialog } from '@/components/admin/InviteUserDialog'
import { cn } from '@/lib/utils'
import {
  INVITATION_STATUSES,
  STATUS_LABEL,
  getDevMailbox,
  getInvitationEmailConfig,
  listInvitations,
  type CapturedInvitationEmail,
  type InvitationEmailConfig,
  type InvitationList,
  type InvitationStatus,
} from '@/lib/invitations'

const PAGE_SIZE = 20

export function EmailSetupNotice({ config }: { config: InvitationEmailConfig | null }) {
  if (!config) return null
  if (config.mode === 'dev_capture') {
    return (
      <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Development mode: invitation emails are captured locally and <strong>not sent</strong>. Captured messages are development-only.</p>
      </div>
    )
  }
  if (config.smtpReady) return null
  return (
    <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div>
        <p className="font-medium">Invitation email is not configured, so invitations are saved but not sent.</p>
        <p className="text-muted-foreground">Set on the API server: {config.missing.join(', ')}. Optional: {config.optional.join('; ')}.</p>
      </div>
    </div>
  )
}

function DevMailbox({ refreshKey }: { refreshKey: number }) {
  const [messages, setMessages] = useState<CapturedInvitationEmail[]>([])
  useEffect(() => {
    getDevMailbox().then((r) => setMessages(r.messages)).catch(() => setMessages([]))
  }, [refreshKey])
  if (!messages.length) return null
  return (
    <Card className="border-dashed border-amber-400">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Captured invitation emails <span className="text-amber-700 dark:text-amber-300">(development only)</span></CardTitle>
        <CardDescription>Local test mail. Nothing here was sent. Each link is single-use.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {messages.slice(0, 5).map((m) => (
          <div key={`${m.id}-${m.capturedAt}`} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs">
            <span className="break-all">{m.to} · {new Date(m.capturedAt).toLocaleTimeString()}</span>
            <a className="font-medium text-primary hover:underline" href={m.acceptUrl} target="_blank" rel="noreferrer">Open accept link</a>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** Searchable, paginated invitation management. Platform-wide until real tenancy scopes it. */
export function Invitations() {
  const [status, setStatus] = useState<InvitationStatus | undefined>('pending')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<InvitationList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [config, setConfig] = useState<InvitationEmailConfig | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => { setSearch(query.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    getInvitationEmailConfig().then(setConfig).catch(() => setConfig(null))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await listInvitations({ status, q: search || undefined, page, pageSize: PAGE_SIZE }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load invitations')
    } finally {
      setLoading(false)
    }
  }, [status, search, page])

  useEffect(() => { load() }, [load, refreshKey])
  const refresh = () => setRefreshKey((k) => k + 1)

  const filters: { key: InvitationStatus | undefined; label: string; count?: number }[] = [
    ...INVITATION_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], count: data?.counts[s] })),
    { key: undefined, label: 'All' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invitations</h1>
          <p className="text-muted-foreground">Learner invitations to SpashtAI. Pending invitations are not user accounts.</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}><MailPlus className="mr-2 h-4 w-4" /> Invite user</Button>
      </div>

      <EmailSetupNotice config={config} />

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => { setStatus(f.key); setPage(1) }}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              status === f.key ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {f.label}{f.count !== undefined && <span className="ml-1.5 tabular-nums">{f.count}</span>}
          </button>
        ))}
        <Input
          aria-label="Search invitations"
          placeholder="Search by email or name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto w-full sm:w-64"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && !data ? (
        <div className="animate-pulse text-muted-foreground">Loading invitations…</div>
      ) : data && data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-12 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">{search ? 'No invitations match your search' : status ? `No ${STATUS_LABEL[status].toLowerCase()} invitations` : 'No invitations yet'}</p>
          {!search && <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}>Invite user</Button>}
        </div>
      ) : data ? (
        <>
          <InvitationTable invitations={data.items} onChanged={refresh} />
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{data.total} invitation{data.total === 1 ? '' : 's'} · Page {data.page} of {data.totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      ) : null}

      {config?.mode === 'dev_capture' && <DevMailbox refreshKey={refreshKey} />}

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} onSent={refresh} />
    </div>
  )
}
