import { createHash } from 'node:crypto'
import { assessPaceEvidence } from '../analytics/pace'
import { hasPaceClaim } from '../analytics/paceClaims'
import { REPLAY_PARSER_VERSION, type ReplayWordEvidence } from './replay-word-evidence'
import type { TranscriptSegment } from './transcript-parser'

export const REPLAY_EVIDENCE_VERSION = 'replay-delivery-v1'
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
export interface ReplayRecording {
  uploadId: string
  signature: string
  duration: number | null
  timelineOrigin: 'retained_media_seconds'
}
export interface ReplayEvidenceInput {
  version: typeof REPLAY_EVIDENCE_VERSION
  recording: ReplayRecording | null
  transcriptRevision: string
  transcriptSource: string
  words: ReplayWordEvidence | null
  supplementaryTranscript: { revision: string | null; status: 'matches' | 'different_not_aligned' | 'unavailable' } | null
  analysisSelectionRevision?: string | null
}
export interface ReplaySelection {
  speaker: string
  transcriptRevision: string
  recordingSignature: string | null
  revision: string
  provenance: 'user_confirmed'
}
export function selectionMatches(selection: ReplaySelection | null, input: ReplayEvidenceInput): boolean {
  return !!selection && selection.provenance === 'user_confirmed' &&
    typeof selection.speaker === 'string' && !!selection.speaker.trim() && typeof selection.revision === 'string' && !!selection.revision &&
    selection.transcriptRevision === input.transcriptRevision && selection.recordingSignature === (input.recording?.signature ?? null)
}
export function replaySegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value) || value.some(s => !s || typeof s.speaker !== 'string' || typeof s.text !== 'string')) return []
  return value
}
export function transcriptRevision(segments: TranscriptSegment[]): string { return digest(segments.map(s => [s.speaker, s.text])) }
export function legacyInput(segments: TranscriptSegment[], source: string): ReplayEvidenceInput {
  return { version: REPLAY_EVIDENCE_VERSION, recording: null, transcriptRevision: transcriptRevision(segments), transcriptSource: source, words: null, supplementaryTranscript: null }
}
export interface ReplayMoment {
  id: string
  kind: 'word_gap'
  start: number
  end: number
  gapSeconds: number
  wordIds: string[]
  description: string
  limitation: string
}
export function buildReplayEvidence(input: ReplayEvidenceInput, selection: ReplaySelection | null, segments: TranscriptSegment[]) {
  const revisionMatches = input.transcriptRevision === transcriptRevision(segments)
  const confirmed = revisionMatches && selectionMatches(selection, input) && segments.some(s => s.speaker === selection?.speaker)
  const raw = input.words
  const recording = input.recording && typeof input.recording.uploadId === 'string' && !!input.recording.uploadId &&
    typeof input.recording.signature === 'string' && !!input.recording.signature && input.recording.timelineOrigin === 'retained_media_seconds'
    ? { uploadId: input.recording.uploadId, signature: input.recording.signature, duration: input.recording.duration, timelineOrigin: input.recording.timelineOrigin } : null
  const duration = recording?.duration
  const base = {
    version: REPLAY_EVIDENCE_VERSION, transcriptRevision: input.transcriptRevision,
    recording, supplementaryTranscript: input.supplementaryTranscript,
    identity: { state: confirmed ? 'confirmed' : 'confirmation_required', speaker: confirmed ? selection!.speaker : null, revision: confirmed ? selection!.revision : null },
    source: raw?.provider ?? input.transcriptSource, accuracy: 'not_human_validated', acousticIsolation: 'unknown', overlapDetection: 'unknown',
    measurement: 'eligible learner stretches, including internal gaps; excluding other speakers and gaps of 2 seconds or more',
    speakers: [...new Set(segments.map(s => s.speaker))].filter(s => s !== 'Unassigned speaker').map(speaker => ({
      speaker, excerpt: segments.find(s => s.speaker === speaker)?.text.slice(0, 200) ?? '',
      preview: null as { start: number; end: number } | null,
    })),
    limitations: ['Model-estimated word boundaries are not a timing-accuracy certification.', 'One confirmed label may cover only part of your speech if diarization split your identity.', 'Mixed meeting audio is not isolated learner speech.'],
  }
  const unavailable = (reason: string) => ({ ...base, state: 'unavailable', reason, coverage: 0, eligibleWords: 0, excludedWords: 0,
    pace: { wpm: null as number | null, status: 'insufficient_evidence' }, moments: [] as ReplayMoment[] })
  if (!revisionMatches) return unavailable('transcript_revision_mismatch')
  if (!raw || raw.version !== REPLAY_PARSER_VERSION) return unavailable('word_timing_missing_or_legacy')
  if (!Array.isArray(raw.words) || raw.words.some(w => !w || typeof w.text !== 'string' || typeof w.id !== 'string' || !w.id || (w.speaker !== null && typeof w.speaker !== 'string')) ||
      new Set(raw.words.map(w => w.id)).size !== raw.words.length ||
      !['aws_batch', 'aws_streaming'].includes(raw.provider) || typeof raw.complete !== 'boolean') return unavailable('word_evidence_malformed')
  // Same counts alone are not a lexical binding. Compare displayed words and
  // labels to the retained provider sequence, independent of segment grouping.
  const tokens = (text: string) => text.trim().split(/\s+/).filter(Boolean)
  const displayWords = segments.flatMap(s => tokens(s.text).map(t => [s.speaker, t]))
  const providerWords = raw.words.flatMap(w => tokens(w.text).map(t => [w.speaker ?? 'Unassigned speaker', t]))
  if (digest(displayWords) !== digest(providerWords)) return unavailable('word_transcript_mismatch')
  if (!duration || !Number.isFinite(duration) || duration <= 0) return unavailable('media_duration_unavailable')
  const words = raw.words
  const bounded = words.map(w => typeof w.start === 'number' && Number.isFinite(w.start) &&
    typeof w.end === 'number' && Number.isFinite(w.end) && w.start >= 0 && w.end > w.start && w.end <= duration)
  // Validate per-word, including order within the same label, not assumed solo speech.
  const last = new Map<string, number>()
  const valid = words.map((w, i) => {
    const okay = !!w.text.trim() && !!w.speaker && bounded[i] && w.start! >= (last.get(w.speaker) ?? 0)
    // Impossible boundaries cannot poison all following speech for this label.
    if (w.speaker && bounded[i]) last.set(w.speaker, Math.max(last.get(w.speaker) ?? 0, w.end!))
    return okay
  })
  const overlaps = words.map(() => false)
  const ordered = words.map((w, i) => ({ w, i })).filter(({ i }) => bounded[i])
    .sort((a, b) => a.w.start! - b.w.start!)
  let furthest: typeof ordered[number] | undefined
  for (const item of ordered) {
    if (furthest && item.w.start! < furthest.w.end!) { overlaps[item.i] = true; overlaps[furthest.i] = true }
    if (!furthest || item.w.end! > furthest.w.end!) furthest = item
  }
  const previews = new Map<string, number[]>()
  let previewRun: number[] = []
  const finishPreview = () => {
    if (!previewRun.length) return
    const start = words[previewRun[0]].start!
    const sample = previewRun.filter(i => words[i].end! - start <= 5)
    previewRun = []
    if (sample.length < 3 || words[sample.at(-1)!].end! - start < 1) return
    const label = words[sample[0]].speaker!
    const previous = previews.get(label)
    if (!previous || words[sample.at(-1)!].end! - start >
        words[previous.at(-1)!].end! - words[previous[0]].start!) previews.set(label, sample)
  }
  for (const { w, i } of ordered) {
    if (!valid[i] || overlaps[i]) { finishPreview(); continue }
    const previous = previewRun.at(-1)
    if (previous != null && (words[previous].speaker !== w.speaker || w.start! - words[previous].end! >= 2)) finishPreview()
    previewRun.push(i)
  }
  finishPreview()
  for (const speaker of base.speakers) {
    const sample = previews.get(speaker.speaker)
    if (!sample) continue
    speaker.preview = { start: words[sample[0]].start!, end: words[sample.at(-1)!].end! }
    speaker.excerpt = sample.map(i => words[i].text).join(' ').slice(0, 200)
  }
  if (!confirmed) return unavailable('confirm_learner')
  // Speaker-grouped provider items can place another speaker's word later in
  // the array even though it occurs inside a learner's apparent word gap.
  // Query temporal occupancy, not just neighboring array entries.
  const otherSpeech = ordered.filter(({ w }) => w.speaker !== selection!.speaker)
  const otherEnds: number[] = []
  for (const { w } of otherSpeech) otherEnds.push(Math.max(otherEnds.at(-1) ?? 0, w.end!))
  const gapContainsOtherSpeech = (start: number, end: number) => {
    let low = 0, high = otherSpeech.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (otherSpeech[mid].w.start! < end) low = mid + 1
      else high = mid
    }
    return low > 0 && otherEnds[low - 1] > start
  }
  const learner = words.filter(w => w.speaker === selection!.speaker)
  const accepted: number[][] = []
  let current: number[] = []
  const finish = () => { if (current.length) accepted.push(current); current = [] }
  words.forEach((w, i) => {
    if (w.speaker !== selection!.speaker || !valid[i] || overlaps[i]) { finish(); return }
    const prev = current.at(-1)
    if (prev != null && (w.start! - words[prev].end! >= 2 || gapContainsOtherSpeech(words[prev].end!, w.start!))) finish()
    current.push(i)
  })
  finish()
  const eligible = accepted.filter(indices => {
    const seconds = words[indices.at(-1)!].end! - words[indices[0]].start!
    const rate = indices.length / seconds * 60
    return indices.length >= 8 && seconds >= 4 && rate >= 40 && rate <= 300
  })
  const totalWords = eligible.reduce((sum, s) => sum + s.length, 0)
  const speakingSeconds = eligible.reduce((sum, s) => sum + words[s.at(-1)!].end! - words[s[0]].start!, 0)
  const expected = segments.filter(s => s.speaker === selection!.speaker).reduce((n, s) => n + s.text.trim().split(/\s+/).filter(Boolean).length, 0)
  const assessed = assessPaceEvidence({ source: 'word_timestamps', status: raw.complete ? 'available' : 'insufficient_evidence',
    samples: eligible.length, totalWords, speakingSeconds, estimatedSamples: 0,
    timestampedWordCount: words.filter((w, i) => w.speaker === selection!.speaker && valid[i]).length,
    transcriptWordCount: expected, invalidTimestampCount: 0, outOfOrderTimestampCount: 0 }, expected)
  const moments: ReplayMoment[] = []
  for (const indices of accepted) {
    if (indices.length < 8) continue
    for (let j = 1; j < indices.length && moments.length < 5; j++) {
      const a = words[indices[j - 1]], b = words[indices[j]]
      const gap = b.start! - a.end!
      if (gap < 0.6 || gap >= 2) continue
      const start = Math.max(words[indices[0]].start!, a.start! - 1)
      const end = Math.min(words[indices.at(-1)!].end!, b.end! + 1)
      moments.push({ id: digest([input.recording?.signature, selection!.revision, a.id, b.id]), kind: 'word_gap', start, end,
        gapSeconds: gap, wordIds: [a.id, b.id], description: `${gap.toFixed(1)}-second gap between transcribed words.`,
        limitation: 'This is a model-timed word gap, not verified silence or a judgment of pause quality.' })
    }
  }
  const coverage = expected > 0 ? Math.min(totalWords, expected) / Math.max(totalWords, expected) : 0
  return { ...base, state: !raw.complete || coverage < .85 ? 'partial' : moments.length ? 'available' : 'empty',
    reason: !raw.complete ? 'provider_stream_incomplete' : null, coverage, eligibleWords: totalWords,
    excludedWords: Math.max(0, learner.length - totalWords), pace: { wpm: assessed.wpm, status: assessed.status }, moments }
}

/** Field-local guard keeps unrelated content feedback rather than dropping entire insights. */
export function neutralContent(value: unknown, allowPersonal = true): unknown {
  if (typeof value === 'string') return value.split(/(?<=[.!?])\s+/).filter(s => !hasPaceClaim(s) &&
    !/\b(voice|pitch|tone|interrupt\w*|confiden\w*|nervous|emotion\w*|personality|speaking share|speaking time|monologue)\b/i.test(s) &&
    (allowPersonal || !/\b(you|your|yourself)\b/i.test(s))).join(' ').trim()
  if (Array.isArray(value)) return value.map(v => neutralContent(v, allowPersonal)).filter(v => v !== '')
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, neutralContent(v, allowPersonal)]))
  return value
}
