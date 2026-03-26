import type { TranscriptSegment } from './transcript-parser'

export interface ReplayMetrics {
  wordsPerMinute: number
  fillerWordCount: number
  fillerWordRate: number
  hedgingCount: number
  hedgingRate: number
  avgSentenceLength: number
  vocabularyDiversity: number
  totalTurns: number
  speakingPercentage: number
  interruptionCount: number
  longestMonologueSec: number
  questionsAsked: number
  repetitionRequests: number
  avgResponseTimeSec: number | null
}

// True fillers: words/phrases that add no meaning and are verbal crutches
const SIMPLE_FILLERS = ['um', 'uh', 'erm', 'ah']
const PHRASE_FILLERS = ['you know', 'I mean', 'basically', 'actually', 'literally']

// Context-dependent fillers: only count in filler positions
// "right?" at end of clause = tag question filler
// "so" at start of sentence = filler; mid-sentence = normal conjunction
// "like" not preceded by "would/looks/feels" = filler usage
// "well" at start of a clause = filler

const HEDGING_PHRASES = [
  'I think', 'I guess', 'maybe', 'probably', 'sort of', 'kind of',
  'perhaps', 'it seems', 'I suppose', 'not sure', 'might be',
  'could be', 'I believe', 'in my opinion', 'more or less',
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
  let count = 0

  // Simple fillers: always count
  for (const filler of SIMPLE_FILLERS) {
    const regex = new RegExp(`\\b${filler}\\b`, 'gi')
    count += (lower.match(regex) || []).length
  }

  // Phrase fillers: always count
  for (const filler of PHRASE_FILLERS) {
    const regex = new RegExp(`\\b${filler}\\b`, 'gi')
    count += (lower.match(regex) || []).length
  }

  // "right?" as tag question (end of clause)
  count += (lower.match(/,\s*right\s*\?/g) || []).length
  count += (lower.match(/\bright\s*\?\s*$/gm) || []).length

  // "so" at start of sentence/clause (filler "so")
  count += (lower.match(/(^|[.!?]\s+)so\b/gm) || []).length
  count += (lower.match(/,\s*so\b/g) || []).length

  return count
}

function countHedging(text: string): number {
  const lower = text.toLowerCase()
  return HEDGING_PHRASES.reduce((count, phrase) => {
    const regex = new RegExp(`\\b${phrase}\\b`, 'gi')
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

export function findMatchingSpeaker(segments: TranscriptSegment[], name: string): string | null {
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

export function getDetectedSpeakers(segments: TranscriptSegment[]): string[] {
  return [...new Set(segments.map((s) => s.speaker))]
}

export function calculateReplayMetrics(
  segments: TranscriptSegment[],
  primarySpeaker?: string,
  durationSec?: number,
  transcriptionSource?: string
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
  const primaryHedgingCount = countHedging(primaryText)
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
  const hedgingRate = primaryWordCount > 0
    ? (primaryHedgingCount / primaryWordCount) * 100
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

  // Interruptions: only reliable when we have audio-level timestamps (AWS Transcribe).
  // Uploaded VTT/text transcripts have imprecise, overlapping timestamps from the
  // transcription tool — not actual interruptions. Skip for non-audio sources.
  let interruptionCount = 0
  const hasReliableTimestamps = transcriptionSource === 'aws_transcribe'
  if (hasReliableTimestamps) {
    const INTERRUPTION_OVERLAP_THRESHOLD = 1.5
    for (let i = 1; i < segments.length; i++) {
      const curr = segments[i]
      const prev = segments[i - 1]
      if (
        curr.speaker !== prev.speaker &&
        (curr.speaker === primarySpeaker || prev.speaker === primarySpeaker) &&
        curr.startTime != null &&
        prev.endTime != null
      ) {
        const overlap = prev.endTime - curr.startTime
        if (overlap > INTERRUPTION_OVERLAP_THRESHOLD) {
          interruptionCount++
        }
      }
    }
  }

  // Longest monologue: longest contiguous block (by time or word count) from primary speaker
  let longestMonologueSec = 0
  let monoStart: number | null = null
  let monoEnd: number | null = null
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg.speaker === primarySpeaker) {
      if (monoStart == null && seg.startTime != null) monoStart = seg.startTime
      if (seg.endTime != null) monoEnd = seg.endTime
    } else {
      if (monoStart != null && monoEnd != null) {
        longestMonologueSec = Math.max(longestMonologueSec, monoEnd - monoStart)
      }
      monoStart = null
      monoEnd = null
    }
  }
  if (monoStart != null && monoEnd != null) {
    longestMonologueSec = Math.max(longestMonologueSec, monoEnd - monoStart)
  }

  // Questions asked by the primary speaker
  const questionsAsked = primarySegments.reduce((count, seg) => {
    const questions = seg.text.match(/\?/g)
    return count + (questions ? questions.length : 0)
  }, 0)

  // Repetition requests: only count when another speaker asks the primary speaker
  // to repeat, and only if it follows the primary speaker's turn (contextual check).
  const REPEAT_PATTERNS = [
    /\bcan you repeat\b/i, /\bcould you repeat\b/i, /\brepeat that\b/i,
    /\bsay that again\b/i, /\bwhat did you (just )?say\b/i,
    /\bdidn'?t (catch|hear|get) (that|what you)\b/i,
    /\bcome again\b/i, /\bone more time\b/i,
  ]
  let repetitionRequests = 0
  for (let i = 1; i < segments.length; i++) {
    const curr = segments[i]
    const prev = segments[i - 1]
    if (
      curr.speaker !== primarySpeaker &&
      prev.speaker === primarySpeaker &&
      REPEAT_PATTERNS.some((pat) => pat.test(curr.text))
    ) {
      repetitionRequests++
    }
  }

  // Average response time: gap between other speaker ending and primary speaker starting
  const responseTimes: number[] = []
  for (let i = 1; i < segments.length; i++) {
    const curr = segments[i]
    const prev = segments[i - 1]
    if (
      curr.speaker === primarySpeaker &&
      prev.speaker !== primarySpeaker &&
      curr.startTime != null &&
      prev.endTime != null &&
      curr.startTime >= prev.endTime
    ) {
      responseTimes.push(curr.startTime - prev.endTime)
    }
  }
  const avgResponseTimeSec = responseTimes.length > 0
    ? Math.round((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) * 10) / 10
    : null

  return {
    wordsPerMinute: wpm,
    fillerWordCount: primaryFillerCount,
    fillerWordRate: Math.round(fillerRate * 100) / 100,
    hedgingCount: primaryHedgingCount,
    hedgingRate: Math.round(hedgingRate * 100) / 100,
    avgSentenceLength: Math.round(avgSentLen * 10) / 10,
    vocabularyDiversity: Math.round(vocabDiv * 10) / 10,
    totalTurns: turns,
    speakingPercentage: Math.round(speakingPct * 10) / 10,
    interruptionCount,
    longestMonologueSec: Math.round(longestMonologueSec),
    questionsAsked,
    repetitionRequests,
    avgResponseTimeSec,
  }
}
