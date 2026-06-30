import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { findSpeechSpans, SPEECH_HIGHLIGHT_CLASS } from '@/lib/speechPatterns'

export interface TurnMetrics {
  word_count: number
  filler_count: number
  filler_rate: number
  hedging_count: number
  acknowledgment_count?: number
  vocab_diversity?: number
  wpm?: number | null
  speaking_seconds?: number | null
  qualitative_pace?: string | null
  coaching_tip?: string | null
}

function paceLabel(pace?: string | null): string {
  if (!pace || pace === 'not-enough-data') return '—'
  return pace.charAt(0).toUpperCase() + pace.slice(1)
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

/** Normalize persisted /turns metrics into the live-session TurnMetrics shape. */
export function normalizeTurnMetricsFromApi(
  raw: Record<string, unknown> | null | undefined,
  text?: string,
): TurnMetrics | undefined {
  if (!raw) return undefined
  const word_count = Number(raw.word_count ?? 0)
  const filler_count = Number(raw.filler_count ?? 0)
  const filler_rate = Number(
    raw.filler_rate ?? (word_count > 0 ? (filler_count / word_count) * 100 : 0),
  )
  const hedging_count = Number(raw.hedging_count ?? 0)
  const wpm = raw.wpm != null && raw.wpm !== '' ? Number(raw.wpm) : null
  const speaking_seconds =
    raw.speaking_seconds != null && raw.speaking_seconds !== ''
      ? Number(raw.speaking_seconds)
      : null
  let vocab_diversity =
    raw.vocab_diversity != null && raw.vocab_diversity !== ''
      ? Number(raw.vocab_diversity)
      : undefined
  if (vocab_diversity == null && text) {
    vocab_diversity = vocabDiversityOf(text)
  }
  const qualitative_pace =
    typeof raw.qualitative_pace === 'string'
      ? raw.qualitative_pace
      : wpm != null
        ? qualitativePaceFromWpm(wpm)
        : null

  return {
    word_count,
    filler_count,
    filler_rate,
    hedging_count,
    acknowledgment_count: Number(raw.acknowledgment_count ?? 0),
    vocab_diversity,
    wpm: Number.isFinite(wpm as number) ? wpm : null,
    speaking_seconds: Number.isFinite(speaking_seconds as number) ? speaking_seconds : null,
    qualitative_pace,
    coaching_tip: typeof raw.coaching_tip === 'string' ? raw.coaching_tip : null,
  }
}

function HighlightedSpeechText({ text }: { text: string }) {
  const spans = useMemo(() => findSpeechSpans(text), [text])
  if (spans.length === 0) return <>{text}</>

  const nodes: ReactNode[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) nodes.push(text.slice(cursor, span.start))
    const slice = text.slice(span.start, span.end)
    nodes.push(
      <mark key={`${span.start}-${span.kind}`} className={SPEECH_HIGHLIGHT_CLASS[span.kind]}>
        {slice}
      </mark>,
    )
    cursor = span.end
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <>{nodes}</>
}

export function UserTurnBubble({
  content,
  metrics,
  children,
}: {
  content?: string
  metrics: TurnMetrics
  /** When set, renders instead of plain `content` (e.g. karaoke in Playback). */
  children?: ReactNode
}) {
  const [highlight, setHighlight] = useState(false)

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
        {children ??
          (content ? (
            <p className="whitespace-pre-wrap break-words">
              {highlight ? <HighlightedSpeechText text={content} /> : content}
            </p>
          ) : null)}
      </div>
      <div className="flex-shrink-0 self-end">
        <TurnMetricsPopover metrics={metrics} onOpenChange={setHighlight} />
      </div>
    </div>
  )
}

export function TurnMetricsPopover({
  metrics,
  onOpenChange,
}: {
  metrics: TurnMetrics
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const PANEL_W = 240
  const PANEL_H = 300

  const setOpenState = useCallback((next: boolean) => {
    setOpen(next)
  }, [])

  const updatePosition = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const margin = 8
    let top = rect.bottom + margin
    let left = Math.max(margin, rect.right - PANEL_W)
    if (top + PANEL_H > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - PANEL_H - margin)
    }
    if (left + PANEL_W > window.innerWidth - margin) {
      left = window.innerWidth - PANEL_W - margin
    }
    setPos({ top, left })
  }, [])

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      const next = !wasOpen
      if (next) {
        requestAnimationFrame(updatePosition)
      }
      return next
    })
  }, [updatePosition])

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenState(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpenState])

  const vocabPct =
    metrics.vocab_diversity != null ? Math.round(metrics.vocab_diversity * 100) : null

  const panel = open ? (
    <>
      <div className="fixed inset-0 z-40" aria-hidden onClick={() => setOpenState(false)} />
      <div
        role="tooltip"
        className="fixed z-50 max-h-[min(320px,calc(100vh-16px))] w-60 overflow-y-auto rounded-lg border border-border bg-popover p-3 text-left text-popover-foreground shadow-lg"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-[11px] font-semibold">This turn</div>
        <dl className="space-y-1 text-[10px]">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">WPM</dt>
            <dd>{metrics.wpm != null ? metrics.wpm.toFixed(0) : '—'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Fillers</dt>
            <dd>
              {metrics.filler_count} ({metrics.filler_rate.toFixed(1)}%)
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Hedging</dt>
            <dd>{metrics.hedging_count}</dd>
          </div>
          {(metrics.acknowledgment_count ?? 0) > 0 && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Acknowledgments</dt>
              <dd>{metrics.acknowledgment_count}</dd>
            </div>
          )}
          {vocabPct != null && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Vocabulary</dt>
              <dd>{vocabPct}%</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Pace</dt>
            <dd>{paceLabel(metrics.qualitative_pace)}</dd>
          </div>
        </dl>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 text-[9px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className={`${SPEECH_HIGHLIGHT_CLASS.filler} px-1 py-0 text-[8px]`}>filler</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={`${SPEECH_HIGHLIGHT_CLASS.hedging} px-1 py-0 text-[8px]`}>hedging</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={`${SPEECH_HIGHLIGHT_CLASS.acknowledgment} px-1 py-0 text-[8px]`}>
              okay/yeah
            </span>
          </span>
        </div>
        <p className="mt-2 text-[9px] leading-snug text-muted-foreground/80">
          Fillers = um/uh/discourse-like. Okay/yeah = acknowledgments (softer signal). Vocabulary =
          distinct words ÷ total.
        </p>
        {metrics.coaching_tip && (
          <p className="mt-2 border-t pt-2 text-[10px] leading-snug text-muted-foreground">
            {metrics.coaching_tip}
          </p>
        )}
      </div>
    </>
  ) : null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-blue-100/90 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
        aria-label="View turn metrics"
        aria-expanded={open}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {panel && createPortal(panel, document.body)}
    </>
  )
}
