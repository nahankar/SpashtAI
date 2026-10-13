import type { ChatMessage } from '@/features/live-session/types'
import type { PlaybackWord } from '@/components/session/KaraokeText'

const tokens = (text: string) => text.toLowerCase().split(/\s+/).map(word => word.replace(/[^\p{L}\p{N}_']/gu, '')).filter(Boolean).join(' ')
type SourceTurn = { role: string; text: string; words?: unknown }

/** Attach recording-bound words to the same question/answer units shown in
 * history. Text equality fences against stale snapshots or shifted boundaries.
 * Synthetic/interpolated timings never produce interview word highlighting. */
export function interviewPlaybackWords(messages: ChatMessage[], turns: SourceTurn[]): Map<string, PlaybackWord[]> {
  const result = new Map<string, PlaybackWord[]>()
  let cursor = 0
  for (const message of messages) {
    if (message.role === 'assistant') {
      const question = turns[cursor++]
      if (!question || question.role !== 'assistant' || tokens(question.text) !== tokens(message.content)) return result
      continue
    }
    const parts: SourceTurn[] = []
    while (cursor < turns.length && turns[cursor].role === 'user') parts.push(turns[cursor++])
    if (!message.id || tokens(parts.map(part => part.text).join(' ')) !== tokens(message.content)) continue
    const words: PlaybackWord[] = []
    for (const part of parts) for (const value of Array.isArray(part.words) ? part.words : []) {
      if (!value || typeof value !== 'object') continue
      const word = value as Record<string, unknown>
      if (!['actual', 'forced_alignment'].includes(String(word.timingOrigin)) || typeof word.w !== 'string' ||
        typeof word.start !== 'number' || typeof word.end !== 'number' || !Number.isFinite(word.start) ||
        !Number.isFinite(word.end) || word.start < 0 || word.end <= word.start ||
        (words.length > 0 && word.start < words.at(-1)!.end)) continue
      words.push({w:word.w,start:word.start,end:word.end})
    }
    if (words.length) result.set(message.id, words)
  }
  return result
}
