import { useEffect, useState } from 'react'
import { Pencil, Pin, PinOff, RefreshCw, Trash2 } from 'lucide-react'
import { useConfirm } from '@/hooks/useConfirm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { formatTimestamp, normalizeRefreshInterval, parseRefreshInterval, RECENT_QUERY_LIMIT } from './format'
import type { RefreshIntervalSec, SavedQuery, SavedQueryLists } from './types'

function SavedQueryCard({
  query,
  active,
  refreshing,
  error,
  showInterval,
  onOpen,
  onRefresh,
  onTogglePin,
  onRename,
  onInterval,
  onDelete,
}: {
  query: SavedQuery
  active: boolean
  refreshing: boolean
  error?: string
  showInterval: boolean
  onOpen: (query: SavedQuery) => void
  onRefresh: (query: SavedQuery) => void
  onTogglePin: (query: SavedQuery) => Promise<void>
  onRename: (query: SavedQuery, title: string) => Promise<void>
  onInterval: (query: SavedQuery, interval: RefreshIntervalSec) => Promise<void>
  onDelete: (query: SavedQuery) => Promise<void>
}) {
  const confirm = useConfirm()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(query.title)
  const [pending, setPending] = useState(false)
  const interval = String(normalizeRefreshInterval(query.refreshIntervalSec))

  useEffect(() => {
    if (!editing) setDraft(query.title)
  }, [editing, query.title])

  async function run(action: () => Promise<void>) {
    setPending(true)
    try {
      await action()
    } finally {
      setPending(false)
    }
  }

  function settle(work: Promise<void>) {
    void work.catch(() => undefined)
  }

  async function saveTitle() {
    const title = draft.trim()
    if (!title || title.length > 100) return
    try {
      await run(async () => {
        await onRename(query, title)
        setEditing(false)
      })
    } catch {
      // The card shows the request error from the page.
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Delete saved question?',
      description: 'Pinned refresh for this question will stop.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await run(() => onDelete(query))
    } catch {
      // The card shows the request error from the page.
    }
  }

  return (
    <div className={cn('space-y-3 rounded-lg border p-3', active && 'border-primary bg-primary/5')}>
      <div className="flex items-start gap-2">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void saveTitle()
            }}
          >
            <Input
              value={draft}
              maxLength={100}
              autoFocus
              aria-label="Question title"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(false)
              }}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending || !draft.trim()}>Save</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline" onClick={() => onOpen(query)}>
            {query.title}
          </button>
        )}
        <div className="flex shrink-0">
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" aria-pressed={query.pinned} aria-label={query.pinned ? 'Unpin question' : 'Pin question'} disabled={pending} onClick={() => settle(run(() => onTogglePin(query)))}>
            {query.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Refresh saved plan" disabled={pending || refreshing} onClick={() => onRefresh(query)}>
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Rename question" disabled={pending} onClick={() => { setDraft(query.title); setEditing(true) }}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" aria-label="Delete question" disabled={pending} onClick={() => void remove()}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {!editing && (
        <p className="line-clamp-2 text-xs text-muted-foreground" title={query.question}>{query.question}</p>
      )}
      <p className="text-xs text-muted-foreground">Last run {formatTimestamp(query.lastRunAt)}</p>
      {showInterval && (
        <Tabs
          value={interval}
          onValueChange={(value) => {
            const next = parseRefreshInterval(value)
            if (!next || next === normalizeRefreshInterval(query.refreshIntervalSec)) return
            settle(run(() => onInterval(query, next)))
          }}
        >
          <TabsList className="grid h-9 w-full grid-cols-3">
            <TabsTrigger value="30" disabled={pending}>30s</TabsTrigger>
            <TabsTrigger value="60" disabled={pending}>1m</TabsTrigger>
            <TabsTrigger value="300" disabled={pending}>5m</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function SavedQueryRail({
  lists,
  status,
  error,
  activeId,
  refreshing,
  errors,
  onOpen,
  onRefresh,
  onTogglePin,
  onRename,
  onInterval,
  onDelete,
  onRetry,
}: {
  lists: SavedQueryLists
  status: 'loading' | 'ready' | 'error'
  error: string | null
  activeId: string | null
  refreshing: Record<string, boolean>
  errors: Record<string, string>
  onOpen: (query: SavedQuery) => void
  onRefresh: (query: SavedQuery) => void
  onTogglePin: (query: SavedQuery) => Promise<void>
  onRename: (query: SavedQuery, title: string) => Promise<void>
  onInterval: (query: SavedQuery, interval: RefreshIntervalSec) => Promise<void>
  onDelete: (query: SavedQuery) => Promise<void>
  onRetry: () => void
}) {
  return (
    <aside className="space-y-6 xl:sticky xl:top-4 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:pr-1">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Pinned</h2>
          <p className="text-xs text-muted-foreground">
            Auto-refresh runs only while this tab is visible. The default is 1 minute, using the saved plan.
          </p>
        </div>
        {status === 'loading' && <div className="h-24 animate-pulse rounded-lg bg-muted" />}
        {status === 'error' && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm">{error}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetry}>Try again</Button>
          </div>
        )}
        {status === 'ready' && lists.pinned.length === 0 && (
          <p className="text-sm text-muted-foreground">Pin a result to keep it on this list.</p>
        )}
        {status === 'ready' && lists.pinned.map((query) => (
          <SavedQueryCard
            key={query.id}
            query={query}
            active={query.id === activeId}
            refreshing={Boolean(refreshing[query.id])}
            error={errors[query.id]}
            showInterval
            onOpen={onOpen}
            onRefresh={onRefresh}
            onTogglePin={onTogglePin}
            onRename={onRename}
            onInterval={onInterval}
            onDelete={onDelete}
          />
        ))}
      </section>
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Recent</h2>
          <p className="text-xs text-muted-foreground">Last 15 questions</p>
        </div>
        {status === 'loading' && <div className="h-24 animate-pulse rounded-lg bg-muted" />}
        {status === 'ready' && lists.recent.length === 0 && (
          <p className="text-sm text-muted-foreground">Questions you run show up here.</p>
        )}
        {status === 'ready' && lists.recent.slice(0, RECENT_QUERY_LIMIT).map((query) => (
          <SavedQueryCard
            key={query.id}
            query={query}
            active={query.id === activeId}
            refreshing={Boolean(refreshing[query.id])}
            error={errors[query.id]}
            showInterval={false}
            onOpen={onOpen}
            onRefresh={onRefresh}
            onTogglePin={onTogglePin}
            onRename={onRename}
            onInterval={onInterval}
            onDelete={onDelete}
          />
        ))}
      </section>
    </aside>
  )
}
