import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type LearnerSummary = {
  id: string
  name: string
  email: string
  city: string | null
  state: string | null
  joinedAt: string
  lastActiveAt: string | null
}

const dateLabel = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : 'never'

/** Enough detail to tell two accounts with the same name apart. */
export function learnerDetail(learner: LearnerSummary) {
  return [learner.email, [learner.city, learner.state].filter(Boolean).join(', '), `joined ${dateLabel(learner.joinedAt)}`].filter(Boolean).join(' · ')
}

export function LearnerSelector({
  selectedId,
  selected,
  onSelect,
}: {
  selectedId: string
  /** Server-resolved details for the selected id, once the report has loaded. */
  selected: LearnerSummary | null
  onSelect: (id: string) => void
}) {
  const [text, setText] = useState('')
  const [results, setResults] = useState<LearnerSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = text.trim()
    if (q.length < 2) { setResults(null); setError(null); return }
    let current = true
    const timer = window.setTimeout(() => {
      setSearching(true)
      apiClient<{ learners: LearnerSummary[] }>(`/api/admin/analytics/learners/search?q=${encodeURIComponent(q)}`)
        .then((body) => { if (current) { setResults(body.learners); setError(null) } })
        .catch((err: Error) => { if (current) setError(err.message || 'Search failed') })
        .finally(() => { if (current) setSearching(false) })
    }, 300)
    return () => { current = false; window.clearTimeout(timer) }
  }, [text])

  if (selectedId) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Individual learner</p>
          {selected ? (
            <>
              <p className="font-medium">{selected.name || 'Unnamed learner'}</p>
              <p className="truncate text-xs text-muted-foreground">{learnerDetail(selected)}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading learner…</p>
          )}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => onSelect('')}>Clear selection</Button>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">All learners</span>
        <span className="text-xs text-muted-foreground">or view one learner:</span>
      </div>
      <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Search by name or email" aria-label="Search learners" />
      {searching && <p className="text-xs text-muted-foreground">Searching…</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {results && results.length === 0 && !searching && <p className="text-xs text-muted-foreground">No learner matches that name or email.</p>}
      {results && results.length > 0 && (
        <ul className="divide-y rounded-md border" aria-label="Matching learners">
          {results.map((learner) => (
            <li key={learner.id}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => { setText(''); setResults(null); onSelect(learner.id) }}>
                <span className="block text-sm font-medium">{learner.name || 'Unnamed learner'}</span>
                <span className="block truncate text-xs text-muted-foreground">{learnerDetail(learner)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
