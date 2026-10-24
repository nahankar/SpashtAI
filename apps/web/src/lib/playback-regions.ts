type TimedTurn = { role: string; audioStart?: number | null; audioEnd?: number | null }
type Region = { start: number; end: number }
type VerifiedWord = Region & { w: string; timingOrigin: string }

export function verifiedPlaybackWords(value: unknown): VerifiedWord[] | null {
  if (!Array.isArray(value) || !value.length) return null
  let end = 0
  for (const word of value) {
    if (!word || !['actual', 'forced_alignment'].includes(word.timingOrigin) || typeof word.w !== 'string' ||
      !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < end || word.end <= word.start) return null
    end = word.end
  }
  return value
}

/** Every verified cluster is speech, including words after a long thinking
 * pause. Selecting only the largest cluster silently drops the other phrases. */
export function verifiedWordRegions(value: unknown, gapSec = 2.5): Region[] | null {
  const words = verifiedPlaybackWords(value)
  if (!words) return null
  const regions: Region[] = []
  for (const word of words) {
    const last = regions.at(-1)
    if (last && word.start-last.end <= gapSec) last.end = word.end
    else regions.push({ start: word.start, end: word.end })
  }
  return regions
}

export function nextSpeechTime(time: number, enabled: boolean, regions: Region[]): number | 'stop' | null {
  if (!enabled || !regions.length) return null
  if (regions.some(region => time >= region.start-0.05 && time <= region.end+0.05)) return null
  return regions.find(region => region.start > time+0.08)?.start ?? 'stop'
}

export function hasUntimedSpeech(turns: TimedTurn[]): boolean {
  return turns.some(turn => turn.role === 'user' &&
    (turn.audioStart == null || turn.audioEnd == null ||
      !Number.isFinite(turn.audioStart) || !Number.isFinite(turn.audioEnd) || turn.audioEnd <= turn.audioStart))
}

/** Null keeps ordinary word-based skipping. An empty list plays the recording
 * without skipping: incomplete alignment must never erase an audible answer. */
export function fallbackSpeechRegions(turns: TimedTurn[], regions: Region[]): Region[] | null {
  if (!hasUntimedSpeech(turns)) return null
  return regions.filter(region => Number.isFinite(region.start) && Number.isFinite(region.end) &&
    region.start >= 0 && region.end > region.start).sort((a, b) => a.start - b.start)
}

/** The last aligned word is not the recording's end when later speech is
 * unaligned. Trim only to measured speech; without it, retain the full audio. */
export function partialPlaybackEnd(duration: number | null, alignedEnd: number, regions: Region[]): number {
  const detectedEnd = Math.max(0, ...regions.map(region => region.end))
  if (detectedEnd > 0) {
    const end = Math.max(alignedEnd, detectedEnd)
    return duration == null ? end : Math.min(duration, end)
  }
  return duration ?? alignedEnd
}
