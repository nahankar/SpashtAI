import type { TranscriptSegment } from './transcript-parser'

export interface ReplayMetrics {
  wordsPerMinute: number
  fillerWordCount: number
  fillerWordRate: number
  avgSentenceLength: number
  vocabularyDiversity: number
  totalTurns: number
  speakingPercentage: number
}

const FILLER_WORDS = [
  'um', 'uh', 'like', 'you know', 'basically', 'actually',
  'literally', 'so', 'well', 'right', 'I mean',
]

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length
}

function countSentences(text: string): number {
  const byPunctuation = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length
  return Math.max(byPunctuation, text.trim().length > 0 ? 1 : 0)
}

function countFillers(text: string): number {
  const lower = text.toLowerCase()
  return FILLER_WORDS.reduce((count, filler) => {
    const regex = new RegExp(`\\b${filler}\\b`, 'gi')
    return count + (lower.match(regex) || []).length
  }, 0)
}

function uniqueWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2)
  )
}

function findMatchingSpeaker(segments: TranscriptSegment[], name: string): string | null {
  const needle = name.toLowerCase().trim()
  const speakers = [...new Set(segments.map((s) => s.speaker))]

  // Exact case-insensitive match
  const exact = speakers.find((s) => s.toLowerCase().trim() === needle)
  if (exact) return exact

  // Speaker label contains the name, or name contains the speaker label
  const partial = speakers.find((s) => {
    const lower = s.toLowerCase().trim()
    return lower.includes(needle) || needle.includes(lower)
  })
  return partial || null
}

export function calculateReplayMetrics(
  segments: TranscriptSegment[],
  primarySpeaker?: string,
  durationSec?: number
): ReplayMetrics {
  // Resolve primary speaker via case-insensitive matching when a name is provided
  if (primarySpeaker) {
    const matched = findMatchingSpeaker(segments, primarySpeaker)
    primarySpeaker = matched || undefined
  }

  if (!primarySpeaker) {
    const speakerWordCounts = new Map<string, number>()
    for (const seg of segments) {
      const wc = countWords(seg.text)
      speakerWordCounts.set(seg.speaker, (speakerWordCounts.get(seg.speaker) || 0) + wc)
    }
    let maxWords = 0
    for (const [speaker, wc] of speakerWordCounts) {
      if (wc > maxWords) {
        maxWords = wc
        primarySpeaker = speaker
      }
    }
    primarySpeaker = primarySpeaker || 'Speaker'
  }

  const primarySegments = segments.filter((s) => s.speaker === primarySpeaker)
  const allText = segments.map((s) => s.text).join(' ')
  const primaryText = primarySegments.map((s) => s.text).join(' ')

  const totalWordCount = countWords(allText)
  const primaryWordCount = countWords(primaryText)
  const primarySentenceCount = primarySegments.reduce(
    (sum, s) => sum + countSentences(s.text),
    0
  )
  const primaryFillerCount = countFillers(primaryText)
  const primaryUnique = uniqueWords(primaryText)

  // Duration: use timestamps if available, else estimate at 150 WPM
  let duration = durationSec
  if (!duration) {
    const lastEnd = Math.max(
      ...segments.filter((s) => s.endTime != null).map((s) => s.endTime!),
      0
    )
    if (lastEnd > 0) {
      duration = lastEnd
    } else {
      duration = (totalWordCount / 150) * 60
    }
  }
  duration = Math.max(duration, 1)

  const wpm = Math.min(Math.round((primaryWordCount / duration) * 60), 250)
  const fillerRate = primaryWordCount > 0
    ? (primaryFillerCount / primaryWordCount) * 100
    : 0
  const avgSentLen = primarySentenceCount > 0
    ? primaryWordCount / primarySentenceCount
    : 0
  const vocabDiv = primaryWordCount > 0
    ? (primaryUnique.size / primaryWordCount) * 100
    : 0
  const speakingPct = totalWordCount > 0
    ? (primaryWordCount / totalWordCount) * 100
    : 0

  // Turns: each contiguous block by the same speaker counts as one turn
  let turns = 0
  let lastSpeaker = ''
  for (const seg of segments) {
    if (seg.speaker !== lastSpeaker) {
      turns++
      lastSpeaker = seg.speaker
    }
  }

  return {
    wordsPerMinute: wpm,
    fillerWordCount: primaryFillerCount,
    fillerWordRate: Math.round(fillerRate * 100) / 100,
    avgSentenceLength: Math.round(avgSentLen * 10) / 10,
    vocabularyDiversity: Math.round(vocabDiv * 10) / 10,
    totalTurns: turns,
    speakingPercentage: Math.round(speakingPct * 10) / 10,
  }
}
