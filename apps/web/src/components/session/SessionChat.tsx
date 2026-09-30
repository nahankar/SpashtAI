import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Send, Loader2, X, Sparkles } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { apiClient } from '@/lib/api-client'

type ChatRole = 'user' | 'assistant'
interface ChatMessage {
  role: ChatRole
  content: string
}

interface SessionChatProps {
  module: 'elevate' | 'replay'
  sessionId: string
  className?: string
}

/**
 * "Ask AI Coach about this session" — grounded Q&A over one session.
 *
 * Controlled by the `session_chat` feature flag (disabled by default). While the
 * flag is off, this renders the exact inactive "Pro" placeholder the page showed
 * before, so nothing about the default experience changes. When an admin enables
 * the flag, the box becomes an interactive chat. Self-contained and fail-safe —
 * any error degrades to an inline message, never breaks the page.
 */
export function SessionChat({ module, sessionId, className }: SessionChatProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Group the flat message list into Q&A pairs, newest first (latest on top).
  // A pair keeps question-above-answer; `seq` (the question's original index) is
  // a stable key so adding a newer pair at the top doesn't remount older ones.
  const pairs = useMemo(() => {
    const out: { q: ChatMessage | null; a: ChatMessage | null; seq: number }[] = []
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (m.role === 'user') {
        const nextIsAnswer = messages[i + 1]?.role === 'assistant'
        out.push({ q: m, a: nextIsAnswer ? messages[i + 1] : null, seq: i })
        if (nextIsAnswer) i++
      } else {
        out.push({ q: null, a: m, seq: i })
      }
    }
    return out.reverse()
  }, [messages])

  // One-time availability check. Never throws; defaults to disabled.
  useEffect(() => {
    let cancelled = false
    apiClient<{ enabled: boolean }>('/api/session-chat/availability')
      .then((r) => {
        if (!cancelled) setEnabled(Boolean(r?.enabled))
      })
      .catch(() => {
        if (!cancelled) setEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Close the panel on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Newest exchange is on top, so keep the list scrolled to the top on updates.
  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: 0 })
  }, [messages, open])

  async function send() {
    const q = draft.trim()
    if (!q || busy) return
    setError(null)
    const next = [...messages, { role: 'user' as const, content: q }]
    setMessages(next)
    setDraft('')
    setBusy(true)
    try {
      const res = await apiClient<{ reply: string }>('/api/session-chat', {
        method: 'POST',
        body: JSON.stringify({ module, sessionId, messages: next }),
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // While loading availability, render the inert placeholder (same footprint).
  const showPlaceholder = enabled !== true

  if (showPlaceholder) {
    return (
      <div
        className={`relative ml-auto w-full max-w-xs ${className ?? ''}`}
        title="Ask AI Coach is a Pro version feature"
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value=""
          readOnly
          disabled
          placeholder="Ask AI Coach about this session…"
          className="h-8 cursor-not-allowed pl-8 pr-14 text-xs"
        />
        <Badge
          variant="secondary"
          className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide"
        >
          Pro
        </Badge>
      </div>
    )
  }

  return (
    <div ref={rootRef} className={`relative ml-auto w-full max-w-xs ${className ?? ''}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              setOpen(true)
              void send()
            }
          }}
          placeholder="Ask AI Coach about this session…"
          className="h-8 pl-8 pr-8 text-xs"
        />
        <button
          type="button"
          aria-label="Send"
          onClick={() => void send()}
          disabled={busy || !draft.trim()}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border bg-popover p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Ask about this session
            </span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div ref={listRef} className="max-h-64 space-y-3 overflow-y-auto">
            {pairs.length === 0 && (
              <p className="text-xs text-muted-foreground">
                e.g. “Where did I pause?”, “What should I improve?”, “Where should I speak faster?”
              </p>
            )}
            {pairs.map((pair, idx) => (
              <div key={pair.seq} className="space-y-2">
                {pair.q && (
                  <div className="ml-6 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs text-foreground">
                    {pair.q.content}
                  </div>
                )}
                {/* Pending / error belong to the newest (top) unanswered question. */}
                {idx === 0 && !pair.a && busy && (
                  <div className="mr-2 flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                  </div>
                )}
                {idx === 0 && !pair.a && error && (
                  <p className="text-xs text-destructive">{error}</p>
                )}
                {pair.a && (
                  <div className="mr-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-foreground">
                    {pair.a.content}
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="mt-2 text-[10px] text-muted-foreground">
            Type your question above. Answers are grounded in this session’s data.
          </p>
        </div>
      )}
    </div>
  )
}
