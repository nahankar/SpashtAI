import type { ReactNode } from 'react'

export interface PlaybackWord { w: string; start: number; end: number }

// ── Karaoke highlighting on conversation text ──────────────────────────
const KARAOKE_BEHIND = 3
const KARAOKE_AHEAD = 3

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^\w]/g, '')
}

export function KaraokeText({
  text,
  words,
  currentTime,
  active,
  onSeek,
  lightOnDark = false,
}: {
  text: string
  words: PlaybackWord[]
  currentTime: number
  active: boolean
  onSeek: (t: number) => void
  lightOnDark?: boolean
}) {
  let cur = -1
  if (active) {
    for (let i = 0; i < words.length; i++) {
      if (currentTime >= words[i].start) cur = i
      else break
    }
    // Do not hold a previous word through a silence or an unaligned stretch.
    if (cur >= 0 && currentTime > words[cur].end + 0.15) cur = -1
  }

  const bandStart = cur - KARAOKE_BEHIND
  const bandEnd = cur + KARAOKE_AHEAD

  // Walk turn.text and align timed words in order so trailing words (e.g.
  // "schedule?") stay on the correct turn even when STT attached them elsewhere.
  const parts: ReactNode[] = []
  let textIdx = 0
  let matched = 0

  for (let i = 0; i < words.length; i++) {
    const token = normalizeToken(words[i].w)
    if (!token) continue

    let pos = -1
    for (let scan = textIdx; scan < text.length; scan++) {
      const chunk = text.slice(scan)
      const m = chunk.match(/^[\s,;:.!?'"()-]*/)
      const afterPunct = scan + (m?.[0]?.length ?? 0)
      const candidate = text.slice(afterPunct, afterPunct + words[i].w.length + 4)
      if (normalizeToken(candidate.split(/\s/)[0] ?? '') === token) {
        pos = afterPunct
        break
      }
    }
    if (pos < 0) continue

    if (pos > textIdx) {
      parts.push(
        <span key={`gap-${i}`} className={lightOnDark ? 'text-white/90' : undefined}>
          {text.slice(textIdx, pos)}
        </span>,
      )
    }

    const surface = text.slice(pos).match(/^[^\s]+/)?.[0] ?? words[i].w
    const inBand = active && cur >= 0 && i >= bandStart && i <= bandEnd
    const isCurrent = active && i === cur
    const isPast = active && cur >= 0 && i < bandStart

    parts.push(
      <span
        key={`w-${i}-${matched}`}
        aria-current={isCurrent ? 'true' : undefined}
        data-word-state={isCurrent ? 'current' : inBand ? 'context' : 'other'}
        onClick={() => onSeek(words[i].start)}
        className={`cursor-pointer rounded px-0.5 transition-colors ${
          isCurrent
            ? lightOnDark ? 'bg-white/50 text-white font-semibold ring-1 ring-white/70' : 'bg-primary text-primary-foreground font-semibold'
            : inBand
            ? lightOnDark
              ? 'bg-white/30 text-white'
              : 'bg-primary/20 text-foreground'
            : isPast
              ? lightOnDark
                ? 'text-white'
                : 'text-foreground'
              : lightOnDark
                ? 'text-white/75'
                : 'text-muted-foreground'
        }`}
      >
        {surface}
      </span>,
    )
    textIdx = pos + surface.length
    matched++
  }

  if (textIdx < text.length) {
    parts.push(
      <span key="tail" className={lightOnDark ? 'text-white/90' : undefined}>
        {text.slice(textIdx)}
      </span>,
    )
  }

  if (matched === 0) {
    return <p className="whitespace-pre-wrap break-words">{text}</p>
  }

  return <p className="whitespace-pre-wrap break-words">{parts}</p>
}
