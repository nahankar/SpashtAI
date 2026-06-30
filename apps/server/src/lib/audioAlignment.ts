import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg'

export interface SpeechRegion {
  start: number
  end: number
}

export interface AlignableTurn {
  turnIndex: number
  role: string
  text: string
  audioStart?: number | null
  audioEnd?: number | null
  words?: unknown
}

interface DetectOptions {
  /** Silence threshold; quieter than this counts as silence. */
  noiseDb?: number
  /** Minimum silence length (s) to register as a gap. */
  minSilenceSec?: number
  /** Pauses shorter than this are absorbed into the surrounding turn. */
  mergeGapSec?: number
  /** Drop speech blips shorter than this (noise/coughs). */
  minSpeechSec?: number
}

/**
 * Run ffmpeg's silencedetect over an audio file and return the speech regions
 * (the complement of the detected silences), in chronological order.
 *
 * The recording is the user's mic only (the coach is echo-cancelled out), so
 * each contiguous speech region corresponds to one of the user's turns. This is
 * the ground truth for replay/karaoke alignment: the timings come straight from
 * the audio, so they automatically account for greeting lead-in and the coach's
 * (silent, on this track) speaking gaps — things the STT word-clock strips out.
 */
export async function detectSpeechRegions(
  audioPath: string,
  opts: DetectOptions = {},
): Promise<SpeechRegion[]> {
  const noiseDb = opts.noiseDb ?? -30
  const minSilenceSec = opts.minSilenceSec ?? 0.6
  const mergeGapSec = opts.mergeGapSec ?? 3.0
  const minSpeechSec = opts.minSpeechSec ?? 0.35

  // silencedetect writes its results to stderr; -f null discards the decode.
  const { stderr } = await execFileAsync(
    FFMPEG_BIN,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      audioPath,
      '-af',
      `silencedetect=noise=${noiseDb}dB:d=${minSilenceSec}`,
      '-f',
      'null',
      '-',
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  )

  const silences: SpeechRegion[] = []
  let pendingStart: number | null = null
  let maxTime = 0
  for (const line of stderr.split('\n')) {
    const sStart = /silence_start:\s*([0-9.]+)/.exec(line)
    if (sStart) {
      pendingStart = parseFloat(sStart[1])
      maxTime = Math.max(maxTime, pendingStart)
      continue
    }
    const sEnd = /silence_end:\s*([0-9.]+)/.exec(line)
    if (sEnd) {
      const end = parseFloat(sEnd[1])
      maxTime = Math.max(maxTime, end)
      silences.push({ start: pendingStart ?? 0, end })
      pendingStart = null
    }
  }
  // File ends in silence with no closing silence_end → extend to last seen time.
  if (pendingStart != null) silences.push({ start: pendingStart, end: maxTime })

  const duration = maxTime
  if (duration <= 0) return []

  // Speech = complement of the silence intervals within [0, duration].
  const speech: SpeechRegion[] = []
  let cursor = 0
  for (const s of silences.sort((a, b) => a.start - b.start)) {
    if (s.start > cursor + 0.01) speech.push({ start: cursor, end: s.start })
    cursor = Math.max(cursor, s.end)
  }
  if (cursor < duration - 0.01) speech.push({ start: cursor, end: duration })

  // Absorb short within-turn pauses, then drop noise blips.
  const merged: SpeechRegion[] = []
  for (const r of speech) {
    const last = merged[merged.length - 1]
    if (last && r.start - last.end < mergeGapSec) last.end = r.end
    else merged.push({ ...r })
  }
  return merged.filter((r) => r.end - r.start >= minSpeechSec)
}

/**
 * When silencedetect finds more speech blips than user turns (extra coughs,
 * short backchannels), merge adjacent regions — smallest gap first — until
 * the count matches so per-turn alignment can still succeed.
 */
export function mergeRegionsToCount(
  regions: SpeechRegion[],
  targetCount: number,
): SpeechRegion[] {
  if (targetCount <= 0 || regions.length <= targetCount) return regions
  const merged = regions.map((r) => ({ ...r }))
  while (merged.length > targetCount) {
    let bestIdx = 0
    let bestGap = Infinity
    for (let i = 0; i < merged.length - 1; i++) {
      const gap = merged[i + 1].start - merged[i].end
      if (gap < bestGap) {
        bestGap = gap
        bestIdx = i
      }
    }
    merged[bestIdx] = {
      start: merged[bestIdx].start,
      end: merged[bestIdx + 1].end,
    }
    merged.splice(bestIdx + 1, 1)
  }
  return merged
}

/**
 * Per-speech-blip intervals for “Skip gaps” playback. Returns filtered
 * silencedetect regions (not merged across turns) so coach-silent gaps
 * between blips are skipped. Merging into one span per turn hid those gaps.
 */
export function buildSkipPlaybackRegions(
  regions: SpeechRegion[],
  _userTurnCount: number,
  opts: { minTurnStart?: number } = {},
): SpeechRegion[] {
  if (regions.length === 0) return []
  let sorted = [...regions].sort((a, b) => a.start - b.start)
  if (opts.minTurnStart != null) {
    sorted = sorted.filter((r) => r.end > opts.minTurnStart!)
  }
  return sorted
}

/** Word timestamps on a single turn (STT karaoke). */
export interface TurnWordTiming {
  start?: number | null
  end?: number | null
}

/**
 * Derive skip-playback windows from per-word STT timings on user turns.
 * When STT turn boundaries are contiguous, a long coach gap sits inside the
 * turn's word list as a separate cluster — we keep the main speech cluster only.
 */
export function buildSkipIntervalsFromTurnWords(
  turns: {
    role: string
    audioStart?: number | null
    audioEnd?: number | null
    words?: unknown
  }[],
  gapSec = 2.5,
): SpeechRegion[] {
  const out: SpeechRegion[] = []

  for (const turn of turns) {
    if (turn.role !== 'user') continue
    const raw = turn.words
    if (!Array.isArray(raw) || raw.length === 0) {
      if (turn.audioStart != null) {
        out.push({
          start: turn.audioStart,
          end: turn.audioEnd ?? turn.audioStart + 0.1,
        })
      }
      continue
    }

    const words = raw
      .map((w: TurnWordTiming) => ({
        start: typeof w?.start === 'number' ? w.start : null,
        end: typeof w?.end === 'number' ? w.end : null,
      }))
      .filter((w): w is { start: number; end: number } => w.start != null && w.end != null)
      .sort((a, b) => a.start - b.start)
    if (words.length === 0) continue

    type Cluster = { start: number; end: number; weight: number }
    const clusters: Cluster[] = []
    let cur: Cluster = { start: words[0].start, end: words[0].end, weight: 1 }
    for (let i = 1; i < words.length; i++) {
      if (words[i].start - cur.end > gapSec) {
        clusters.push(cur)
        cur = { start: words[i].start, end: words[i].end, weight: 1 }
      } else {
        cur.end = Math.max(cur.end, words[i].end)
        cur.weight += 1
      }
    }
    clusters.push(cur)

    const best = clusters.reduce((a, b) => {
      const scoreA = (a.end - a.start) * a.weight
      const scoreB = (b.end - b.start) * b.weight
      return scoreB > scoreA ? b : a
    })
    out.push({ start: best.start, end: best.end })
  }

  return out.sort((a, b) => a.start - b.start)
}

function distributeWords(
  words: unknown,
  start: number,
  end: number,
): unknown {
  if (!Array.isArray(words) || words.length === 0) return words ?? undefined
  const span = Math.max(end - start, 0)
  // Weight each word's slice by its length (a cheap proxy for spoken duration)
  // rather than spreading uniformly — longer words take longer to say, so this
  // keeps the karaoke estimate better centered without forced alignment.
  const weight = (w: any): number => {
    const text = w && typeof w === 'object' ? String(w.w ?? '') : String(w ?? '')
    return Math.max(text.length, 1)
  }
  const total = words.reduce((s: number, w: any) => s + weight(w), 0) || 1
  let acc = 0
  return words.map((w: any) => {
    const ws = start + (acc / total) * span
    acc += weight(w)
    const we = start + (acc / total) * span
    return w && typeof w === 'object'
      ? { ...w, start: ws, end: we }
      : { w: String(w), start: ws, end: we }
  })
}

export interface AlignmentResult {
  turns: AlignableTurn[]
  aligned: boolean
  regionCount: number
  userTurnCount: number
}

/**
 * Snap each USER turn onto the speech regions detected in the recording, in
 * order, and redistribute that turn's words across its region. Assistant turns
 * keep null audio timings (the coach is not on this track).
 *
 * Returns aligned=false (turns untouched) when the region/turn counts don't
 * line up, so the caller can fall back to its previous strategy rather than
 * emit confidently-wrong timings.
 */
export async function alignTurnsToAudio(
  turns: AlignableTurn[],
  audioPath: string,
  opts: DetectOptions = {},
): Promise<AlignmentResult> {
  const userTurns = turns.filter((t) => t.role === 'user')

  // Try the default merge gap first; if the region count overshoots the number
  // of user turns (extra blips survived), retry with a larger gap to coalesce.
  let regions = await detectSpeechRegions(audioPath, opts)
  if (regions.length > userTurns.length) {
    for (const gap of [4.5, 6.0]) {
      if (regions.length <= userTurns.length) break
      regions = await detectSpeechRegions(audioPath, { ...opts, mergeGapSec: gap })
    }
  }
  // Still too many blips — merge adjacent regions (smallest gap first) down to
  // the user-turn count so alignment can proceed instead of falling back to STT.
  if (regions.length > userTurns.length) {
    regions = mergeRegionsToCount(regions, userTurns.length)
  }

  if (regions.length !== userTurns.length || userTurns.length === 0) {
    return {
      turns,
      aligned: false,
      regionCount: regions.length,
      userTurnCount: userTurns.length,
    }
  }

  const startByIndex = new Map<number, SpeechRegion>()
  userTurns.forEach((t, i) => startByIndex.set(t.turnIndex, regions[i]))

  const out = turns.map((t) => {
    const region = startByIndex.get(t.turnIndex)
    if (!region || t.role !== 'user') return t
    return {
      ...t,
      audioStart: region.start,
      audioEnd: region.end,
      words: distributeWords(t.words, region.start, region.end),
    }
  })

  return {
    turns: out,
    aligned: true,
    regionCount: regions.length,
    userTurnCount: userTurns.length,
  }
}
