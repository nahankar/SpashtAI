/** Replay-only normalization. Structural checks do NOT certify ASR accuracy. */
export const REPLAY_PARSER_VERSION = 'replay-words-v1'
export interface ReplayWord {
  id: string
  text: string
  start: number | null
  end: number | null
  speaker: string | null
  confidence: number | null
}
export interface ReplayWordEvidence {
  version: typeof REPLAY_PARSER_VERSION
  provider: 'aws_batch' | 'aws_streaming'
  complete: boolean
  words: ReplayWord[]
  overlapDetection: 'unknown'
}
type Obj = Record<string, any>
function number(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
function confidence(value: unknown): number | null {
  const n = number(value)
  return n != null && n >= 0 && n <= 1 ? n : null
}
function label(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
/** Exact numeric correspondence only; ambiguous or conflicting joins fail closed. */
export function normalizeBatchWords(data: Obj | null): ReplayWordEvidence {
  const items: Obj[] = Array.isArray(data?.results?.items) ? data.results.items : []
  const sourceSegments = data?.results?.speaker_labels?.segments
  const labels: Obj[] = (Array.isArray(sourceSegments) ? sourceSegments : []).filter(Boolean).flatMap((s: Obj) =>
    (Array.isArray(s.items) ? s.items : []).filter(Boolean).map((i: Obj) => ({ ...i, speaker_label: i.speaker_label ?? s.speaker_label })))
  const joins = new Map<string, Set<string>>()
  for (const i of labels) {
    const start = number(i.start_time), end = number(i.end_time), speaker = label(i.speaker_label)
    if (start == null || end == null || !speaker) continue
    const key = `${start}:${end}`
    if (!joins.has(key)) joins.set(key, new Set())
    joins.get(key)!.add(speaker)
  }
  const words: ReplayWord[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const content = item.alternatives?.[0]?.content
    const text = typeof content === 'string' ? content : ''
    if (item.type === 'punctuation') {
      if (words.length) words[words.length - 1].text += text
      continue
    }
    if (item.type !== 'pronunciation') continue
    const start = number(item.start_time), end = number(item.end_time)
    const candidates = start == null || end == null ? new Set<string>() : joins.get(`${start}:${end}`) ?? new Set<string>()
    const direct = label(item.speaker_label)
    const joined = candidates.size === 1 ? [...candidates][0]! : null
    const speaker = candidates.size > 1 || (direct && joined && direct !== joined) ? null : direct ?? joined
    words.push({ id: `w${words.length}`, text, start, end, speaker, confidence: confidence(item.alternatives?.[0]?.confidence) })
  }
  return { version: REPLAY_PARSER_VERSION, provider: 'aws_batch', complete: true, words, overlapDetection: 'unknown' }
}
export function normalizeStreamingWords(items: Obj[], complete: boolean): ReplayWordEvidence {
  const words: ReplayWord[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    if (item.Type === 'punctuation') {
      if (words.length && typeof item.Content === 'string') words[words.length - 1].text += item.Content
      continue
    }
    if (item.Type !== 'pronunciation') continue
    words.push({ id: `w${words.length}`, text: typeof item.Content === 'string' ? item.Content : '', start: number(item.StartTime),
      end: number(item.EndTime), speaker: label(item.Speaker), confidence: confidence(item.Confidence) })
  }
  return { version: REPLAY_PARSER_VERSION, provider: 'aws_streaming', complete, words, overlapDetection: 'unknown' }
}
export function wordSegments(evidence: ReplayWordEvidence) {
  const segments: Array<{ speaker: string; text: string; startTime: number; endTime: number; confidence: number | null }> = []
  for (const word of evidence.words) {
    const speaker = word.speaker ?? 'Unassigned speaker'
    const previous = segments.at(-1)
    // Preserve missing boundaries; never substitute zero or an invented duration.
    if (previous && previous.speaker === speaker && word.start != null && word.start - previous.endTime < 2) {
      previous.text += ` ${word.text}`
      previous.endTime = word.end ?? NaN
      previous.confidence = null
    } else segments.push({ speaker, text: word.text, startTime: word.start ?? NaN, endTime: word.end ?? NaN, confidence: word.confidence })
  }
  return segments
}
