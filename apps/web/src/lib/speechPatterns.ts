/** Mirror of apps/agent/speech_patterns.py for turn highlighting in Elevate. */

export type SpeechSpanKind = 'filler' | 'hedging' | 'acknowledgment'

const SINGLE_FILLER_RE =
  /\b(?:um|uh|umm|uhh|er|ah|hmm|mmm|basically|actually|literally|you know|i mean)\b/gi

const LIKE_FILLER_RE = /\blike\b/gi
const LIKE_NOT_FILLER_BEFORE =
  /\b(?:(?:i|we|they|he|she|it|you|i'd|we'd|they'd)\s+|would\s+|looks?\s+|feels?\s+|felt\s+|something\s+)$/i

const ACKNOWLEDGMENT_RE =
  /\b(?:ok|okay|yeah|yep|yup|right|so|well|sure|mhm|got it|i see)\b/gi

const HEDGING_RE =
  /\b(i think|maybe|probably|perhaps|kind of|sort of|i guess|i suppose|it seems|i feel like|not sure|might|could be|possibly|a little|somewhat|i believe)\b/gi

export interface SpeechSpan {
  start: number
  end: number
  kind: SpeechSpanKind
}

function overlaps(spans: SpeechSpan[], start: number, end: number): boolean {
  return spans.some((s) => start < s.end && end > s.start)
}

function collectMatches(text: string, re: RegExp, kind: SpeechSpanKind, spans: SpeechSpan[]) {
  const pattern = new RegExp(re.source, re.flags)
  for (const match of text.matchAll(pattern)) {
    if (match.index == null) continue
    const start = match.index
    const end = start + match[0].length
    if (!overlaps(spans, start, end)) spans.push({ start, end, kind })
  }
}

function collectLikeFillers(text: string, spans: SpeechSpan[]) {
  const re = new RegExp(LIKE_FILLER_RE.source, LIKE_FILLER_RE.flags)
  for (const match of text.matchAll(re)) {
    if (match.index == null) continue
    const start = match.index
    const end = start + match[0].length
    const before = text.slice(0, start)
    if (LIKE_NOT_FILLER_BEFORE.test(before) || overlaps(spans, start, end)) continue
    spans.push({ start, end, kind: 'filler' })
  }
}

/** Hedging wins over filler/ack when patterns overlap. */
export function findSpeechSpans(text: string): SpeechSpan[] {
  const spans: SpeechSpan[] = []
  collectMatches(text, HEDGING_RE, 'hedging', spans)
  collectMatches(text, SINGLE_FILLER_RE, 'filler', spans)
  collectLikeFillers(text, spans)
  collectMatches(text, ACKNOWLEDGMENT_RE, 'acknowledgment', spans)
  return spans.sort((a, b) => a.start - b.start)
}

export const SPEECH_HIGHLIGHT_CLASS: Record<SpeechSpanKind, string> = {
  filler: 'rounded-sm bg-amber-300 px-0.5 font-semibold text-blue-950 ring-1 ring-amber-400/60',
  hedging: 'rounded-sm bg-orange-300 px-0.5 font-semibold text-blue-950 ring-1 ring-orange-400/60',
  acknowledgment:
    'rounded-sm bg-sky-200 px-0.5 font-semibold text-blue-950 ring-1 ring-sky-400/60',
}
