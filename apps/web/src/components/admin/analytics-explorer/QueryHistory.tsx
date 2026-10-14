import { useState } from 'react'
import { Pin, PinOff, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { SavedAnalyticsQuery } from './types'

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

function SavedRow({
  query,
  active,
  refreshing,
  onOpen,
  onRefresh,
  onPatch,
  onDelete,
}: {
  query: SavedAnalyticsQuery
  active: boolean
  refreshing: boolean
  onOpen: () => void
  onRefresh: () => void
  onPatch: (changes: Partial<Pick<SavedAnalyticsQuery, 'pinned' | 'title' | 'refreshIntervalSec'>>) => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(query.title)

  return (
    <div className={`rounded-lg border p-3 transition-colors ${active ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}>
      {renaming ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (title.trim()) onPatch({ title: title.trim() })
            setRenaming(false)
          }}
        >
          <Input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Saved query title" autoFocus />
          <Button size="sm" type="submit">Save</Button>
        </form>
      ) : (
        <button type="button" className="w-full text-left" onClick={onOpen} onDoubleClick={() => setRenaming(true)}>
          <span className="block truncate text-sm font-medium">{query.title}</span>
          <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{query.question}</span>
        </button>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        <Badge variant="secondary">{relativeTime(query.lastRunAt)}</Badge>
        {query.pinned && <Badge variant="outline">Every {query.refreshIntervalSec < 60 ? `${query.refreshIntervalSec}s` : `${query.refreshIntervalSec / 60}m`}</Badge>}
        <div className="ml-auto flex gap-1">
          <Button type="button" size="icon" variant="ghost" aria-label="Refresh query" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button type="button" size="icon" variant="ghost" aria-label={query.pinned ? 'Unpin query' : 'Pin query'} onClick={() => onPatch({ pinned: !query.pinned })}>
            {query.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Delete query" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {query.pinned && (
        <div className="mt-2 flex gap-1">
          {[30, 60, 300].map((seconds) => (
            <Button
              key={seconds}
              type="button"
              size="sm"
              variant={query.refreshIntervalSec === seconds ? 'default' : 'outline'}
              className="h-7 px-2 text-xs"
              onClick={() => onPatch({ refreshIntervalSec: seconds as 30 | 60 | 300 })}
            >
              {seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

export function QueryHistory({
  pinned,
  recent,
  activeId,
  refreshingId,
  onOpen,
  onRefresh,
  onPatch,
  onDelete,
}: {
  pinned: SavedAnalyticsQuery[]
  recent: SavedAnalyticsQuery[]
  activeId: string | null
  refreshingId: string | null
  onOpen: (query: SavedAnalyticsQuery) => void
  onRefresh: (query: SavedAnalyticsQuery) => void
  onPatch: (query: SavedAnalyticsQuery, changes: Partial<Pick<SavedAnalyticsQuery, 'pinned' | 'title' | 'refreshIntervalSec'>>) => void
  onDelete: (query: SavedAnalyticsQuery) => void
}) {
  const render = (query: SavedAnalyticsQuery) => (
    <SavedRow
      key={query.id}
      query={query}
      active={activeId === query.id}
      refreshing={refreshingId === query.id}
      onOpen={() => onOpen(query)}
      onRefresh={() => onRefresh(query)}
      onPatch={(changes) => onPatch(query, changes)}
      onDelete={() => onDelete(query)}
    />
  )
  return (
    <Card className="h-fit">
      <CardHeader><CardTitle className="text-base">Saved analysis</CardTitle></CardHeader>
      <CardContent className="max-h-[72vh] space-y-5 overflow-y-auto">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pinned</h2>
          <div className="space-y-2">{pinned.length ? pinned.map(render) : <p className="text-xs text-muted-foreground">Pin a useful answer to keep it live.</p>}</div>
        </section>
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent · last 15</h2>
          <div className="space-y-2">{recent.length ? recent.map(render) : <p className="text-xs text-muted-foreground">Your questions will appear here.</p>}</div>
        </section>
      </CardContent>
    </Card>
  )
}
