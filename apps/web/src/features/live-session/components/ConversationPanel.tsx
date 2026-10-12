import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { stripThinkingBlocks } from '@/lib/stripThinking'
import { COACH_BUBBLE, USER_BUBBLE, normalizeTurnText } from '@/lib/conversation'
import { RealTimeMetrics } from '@/components/analytics/RealTimeMetrics'
import { UserTurnBubble, normalizeTurnMetricsFromApi, type TurnMetrics } from '@/components/session/UserTurnMetrics'
import type { SessionTurnRecord } from '@/hooks/useSessionMetrics'
import type { ChatMessage } from '../types'

// Official LiveKit conversation component using built-in patterns
function lookupTurnMetrics(content: string, map: Record<string, TurnMetrics>): TurnMetrics | undefined {
  const key = normalizeTurnText(content)
  if (map[key]) return map[key]
  for (const [k, v] of Object.entries(map)) {
    if (key.includes(k) || k.includes(key)) return v
  }
  return undefined
}

function qualitativePaceFromWpm(wpm: number): string {
  if (wpm <= 0) return 'not-enough-data'
  if (wpm < 100) return 'slow'
  if (wpm < 120) return 'measured'
  if (wpm <= 160) return 'ideal'
  if (wpm <= 180) return 'fast'
  return 'rapid'
}

function vocabDiversityOf(text: string): number {
  const words = (text.toLowerCase().match(/[a-z']+/g) || [])
  if (words.length === 0) return 0
  return new Set(words).size / words.length
}

// A user "turn" the coach replies to is split by the endpointer into multiple
// agent sub-turns, but the UI stitches them into one bubble. Aggregate every
// sub-turn metric whose committed text falls inside the bubble so the popover
// reflects the WHOLE paragraph (additive counts; WPM from summed words/seconds;
// vocab recomputed from the full bubble text).
function aggregateTurnMetrics(parts: TurnMetrics[], bubbleContent: string): TurnMetrics {
  if (parts.length === 1) return parts[0]
  const sum = (pick: (m: TurnMetrics) => number) => parts.reduce((a, m) => a + (pick(m) || 0), 0)
  const word_count = sum((m) => m.word_count)
  const filler_count = sum((m) => m.filler_count)
  const hedging_count = sum((m) => m.hedging_count)
  const acknowledgment_count = sum((m) => m.acknowledgment_count ?? 0)
  const speaking_seconds = sum((m) => m.speaking_seconds ?? 0)
  const filler_rate = word_count > 0 ? (filler_count / word_count) * 100 : 0
  const wpm = speaking_seconds > 0 ? (word_count / speaking_seconds) * 60 : null
  return {
    word_count,
    filler_count,
    filler_rate,
    hedging_count,
    acknowledgment_count,
    vocab_diversity: vocabDiversityOf(bubbleContent),
    wpm,
    speaking_seconds: speaking_seconds > 0 ? speaking_seconds : null,
    qualitative_pace: wpm != null ? qualitativePaceFromWpm(wpm) : null,
    coaching_tip: parts[parts.length - 1]?.coaching_tip ?? null,
  }
}

// Collect all sub-turn metrics whose committed text is contained in a bubble.
// Uses an 8-word probe (or the whole text if shorter) to avoid mis-matching
// short fragments, and a `consumed` set so a sub-turn is attributed once.
function collectTurnMetricsForBubble(
  bubbleContent: string,
  ordered: { idx: number; text: string; metrics: TurnMetrics }[],
  consumed: Set<number>,
): TurnMetrics[] {
  const bubbleNorm = normalizeTurnText(bubbleContent)
  const parts: TurnMetrics[] = []
  for (const entry of ordered) {
    if (consumed.has(entry.idx)) continue
    const t = normalizeTurnText(entry.text)
    if (!t) continue
    const probe = t.split(' ').slice(0, 8).join(' ')
    if (probe && bubbleNorm.includes(probe)) {
      parts.push(entry.metrics)
      consumed.add(entry.idx)
    }
  }
  return parts
}

// One persisted/streaming message → one chat bubble. Partial updates share the same id
// via upsertStreamingMessage; stitched user turns use user_turn_{n} ids from the agent.
const USER_STITCH_GAP_MS = 90_000

function parseMessageTimestamp(ts: string | undefined): number {
  if (!ts) return 0
  const n = Date.parse(ts)
  return Number.isNaN(n) ? 0 : n
}

interface ChatGroup {
  id: string
  role: string
  content: string
  timestamp: string
  count: number
}

function groupConsecutive(messages: ChatMessage[]): ChatGroup[] {
  const groups: ChatGroup[] = []

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const content =
      m.role === 'assistant' ? stripThinkingBlocks(m.content) : m.content
    if (!content) continue

    const last = groups[groups.length - 1]
    const sameStream = last && last.role === m.role && m.id && last.id === m.id
    const userTimeStitch =
      last &&
      last.role === 'user' &&
      m.role === 'user' &&
      !m.id?.startsWith('user_turn_') &&
      parseMessageTimestamp(m.timestamp) - parseMessageTimestamp(last.timestamp) <=
        USER_STITCH_GAP_MS

    if (sameStream) {
      last.content = content
      last.timestamp = m.timestamp || last.timestamp
    } else if (userTimeStitch) {
      last.content = `${last.content} ${content}`.replace(/\s+/g, ' ').trim()
      last.timestamp = m.timestamp || last.timestamp
      last.count += 1
    } else {
      groups.push({
        id: m.id || `g-${i}`,
        role: m.role,
        content,
        timestamp: m.timestamp,
        count: 1,
      })
    }
  }
  return groups
}

export function ConversationPanel({
  messages,
  turnMetricsByIndex = {},
  turnTextByIndex = {},
  turnMetricsByText = {},
  sessionTurns = [],
  liveMetrics = null,
  showLiveMetrics = false,
  transcriptHidden = false,
  collapsible = false,
  defaultCollapsed = false,
}: {
  messages: ChatMessage[]
  turnMetricsByIndex?: Record<number, TurnMetrics>
  turnTextByIndex?: Record<number, string>
  turnMetricsByText?: Record<string, TurnMetrics>
  /** Persisted /turns records — powers the ⓘ popover on completed sessions. */
  sessionTurns?: SessionTurnRecord[]
  liveMetrics?: import('@/hooks/useSessionMetrics').LiveMetricsSnapshot | null
  showLiveMetrics?: boolean
  transcriptHidden?: boolean
  collapsible?: boolean
  defaultCollapsed?: boolean
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(collapsible && defaultCollapsed)
  const metricsByText = useMemo(() => {
    const map = { ...turnMetricsByText }
    for (const t of sessionTurns) {
      if (t.role !== 'user' || !t.text) continue
      const metrics = normalizeTurnMetricsFromApi(t.metrics, t.text)
      if (metrics) map[normalizeTurnText(t.text)] = metrics
    }
    return map
  }, [turnMetricsByText, sessionTurns])
  const orderedSessionTurnMetrics = useMemo(
    () =>
      sessionTurns
        .filter((t) => t.role === 'user')
        .sort((a, b) => a.turnIndex - b.turnIndex)
        .map((t) => ({
          idx: t.turnIndex,
          text: t.text || '',
          metrics: normalizeTurnMetricsFromApi(t.metrics, t.text),
        }))
        .filter((e): e is { idx: number; text: string; metrics: TurnMetrics } => Boolean(e.metrics)),
    [sessionTurns],
  )
  // Render strictly in chronological (creation) order. Bubbles keep their
  // earliest timestamp, so a stitched user-turn final that arrives alongside the
  // coach reply can't push the user's turn below the response that answers it.
  const groups = useMemo(() => {
    const ordered = messages
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        const dt = parseMessageTimestamp(a.m.timestamp) - parseMessageTimestamp(b.m.timestamp)
        return dt !== 0 ? dt : a.i - b.i
      })
      .map((x) => x.m)
    return groupConsecutive(ordered)
  }, [messages])
  const userTurnCount = useMemo(() => groups.filter((g) => g.role === 'user').length, [groups])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Format timestamp for display
  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp)
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      })
    } catch {
      return ''
    }
  }

  return (
    <div className="mt-2 rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="border-b bg-muted/50 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => collapsible && setCollapsed((c) => !c)}
            disabled={!collapsible}
            className={`flex shrink-0 items-center gap-2 text-left ${collapsible ? 'cursor-pointer' : 'cursor-default'}`}
            aria-expanded={!collapsed}
          >
            {collapsible &&
              (collapsed ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ))}
            <span>
              <span className="block text-sm font-semibold">Conversation</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {userTurnCount} {userTurnCount === 1 ? 'your turn' : 'your turns'}
                {groups.length !== userTurnCount && (
                  <span className="ml-1 opacity-70">· {groups.length} messages</span>
                )}
                {collapsible && collapsed && <span className="ml-1 opacity-70">· click to expand</span>}
              </span>
            </span>
          </button>
          {showLiveMetrics && (
            <RealTimeMetrics
              metrics={liveMetrics}
              isVisible
              variant="inline"
              userTurnCount={userTurnCount}
            />
          )}
        </div>
      </div>
      
      {/* Messages Container */}
      <div
        className={`p-4 space-y-3 max-h-[32rem] min-h-[12rem] overflow-y-auto overflow-x-hidden bg-gradient-to-b from-background to-muted/10 ${
          collapsed ? 'hidden' : ''
        }`}
      >
        {transcriptHidden ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center px-4">
              <div className="text-sm text-muted-foreground">Transcript hidden</div>
              <div className="text-xs text-muted-foreground/60 mt-1">
                Conversation text is not available for your account. Metrics and coaching feedback remain visible.
              </div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <div className="text-sm text-muted-foreground">No messages yet</div>
              <div className="text-xs text-muted-foreground/60 mt-1">Start speaking to begin the conversation</div>
            </div>
          </div>
        ) : (
          <>
            {(() => {
              let userTurnIdx = 0
              // Sub-turn metrics in commit order, with their committed text, so a
              // stitched bubble can aggregate every sub-turn it spans.
              const orderedTurnMetrics = [
                ...Object.keys(turnMetricsByIndex)
                  .map(Number)
                  .sort((a, b) => a - b)
                  .map((idx) => ({
                    idx,
                    text: turnTextByIndex[idx] || '',
                    metrics: turnMetricsByIndex[idx],
                  })),
                ...orderedSessionTurnMetrics,
              ].sort((a, b) => a.idx - b.idx)
              const consumedTurnMetrics = new Set<number>()
              return groups.map((g, i) => {
              let turnMetrics: TurnMetrics | undefined
              if (g.role === 'user') {
                userTurnIdx++
                const parts = collectTurnMetricsForBubble(g.content, orderedTurnMetrics, consumedTurnMetrics)
                turnMetrics = parts.length
                  ? aggregateTurnMetrics(parts, g.content)
                  : (turnMetricsByIndex[userTurnIdx] ?? lookupTurnMetrics(g.content, metricsByText))
              }
              return (
              <div 
                key={g.id || i} 
                className={`flex ${g.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
              >
                <div className={`flex flex-col max-w-[80%] ${g.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div 
                    className={`rounded-2xl px-4 py-2.5 shadow-sm ${
                      g.role === 'user' 
                        ? `${USER_BUBBLE} rounded-tr-sm`
                        : `${COACH_BUBBLE} rounded-tl-sm`
                    }`}
                  >
                    {g.role === 'user' ? (
                      turnMetrics ? (
                        <UserTurnBubble content={g.content} metrics={turnMetrics} />
                      ) : (
                        <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                          {g.content}
                        </p>
                      )
                    ) : (
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                        {g.content}
                      </p>
                    )}
                  </div>
                  
                  <div className="text-[10px] mt-1 px-1 text-muted-foreground">
                    {formatTime(g.timestamp)}
                  </div>
                </div>
              </div>
            )})})()}
            {/* Invisible div for auto-scroll anchor */}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>
    </div>
  )
}
