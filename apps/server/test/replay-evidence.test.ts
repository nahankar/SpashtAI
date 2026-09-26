import { describe, it, expect } from 'vitest'
import { normalizeBatchWords, normalizeStreamingWords, wordSegments, type ReplayWord } from '../src/lib/replay-word-evidence'
import { buildReplayEvidence, transcriptRevision, legacyInput, replaySpeakerCandidates, replaySpeakerResolution, speakerMeetsAssessment, selectionMatches, neutralContent, type ReplayEvidenceInput, type ReplaySelection } from '../src/lib/replay-evidence'
import { replayResultView } from '../src/lib/replay-result-view'
import { calculateReplayMetrics, findMatchingSpeaker } from '../src/lib/replay-metrics'
import { replayCacheKey, isReusableReplayCache } from '../src/lib/replay-recording'

function utterance(speaker: string, start: number, count = 20, step = .5): ReplayWord[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${speaker}-${start}-${i}`, text: `word${i}`, start: start + i * step, end: start + (i + 1) * step, speaker, confidence: null }))
}
function fixture(words = [...utterance('spk_1', 0), ...utterance('spk_0', 15, 10), ...utterance('spk_1', 30)]) {
  const raw = { version: 'replay-words-v1' as const, provider: 'aws_batch' as const, complete: true, words, overlapDetection: 'unknown' as const }
  const segments = wordSegments(raw)
  const input: ReplayEvidenceInput = { version: 'replay-delivery-v1', recording: { signature: 'recording-1', duration: 100, uploadId: 'upload-1', timelineOrigin: 'retained_media_seconds' },
    transcriptRevision: transcriptRevision(segments), transcriptSource: 'aws_transcribe', words: raw, supplementaryTranscript: null }
  const selection: ReplaySelection = { speaker: 'spk_1', transcriptRevision: input.transcriptRevision, recordingSignature: 'recording-1', revision: 'selection-1', provenance: 'user_confirmed' }
  return { input, segments, selection }
}
describe('Replay provider normalization', () => {
  it('keeps punctuation and real nullable confidence with numeric speaker joins', () => {
    const raw = normalizeBatchWords({ results: { items: [
      { type: 'pronunciation', start_time: '0.00', end_time: '0.4', alternatives: [{ content: 'Hello', confidence: '.93' }] },
      { type: 'punctuation', alternatives: [{ content: ',' }] },
      { type: 'pronunciation', start_time: '1', end_time: '1.4', speaker_label: 'spk_1', alternatives: [{ content: 'yes' }] },
    ], speaker_labels: { segments: [{ speaker_label: 'spk_0', items: [{ start_time: '0', end_time: '.40' }] }] } } })
    expect(raw.words).toHaveLength(2)
    expect(raw.words[0]).toMatchObject({ text: 'Hello,', speaker: 'spk_0', confidence: .93, start: 0 })
    expect(raw.words[1].confidence).toBeNull()
  })
  it('does not invent labels or boundaries, and rejects conflicting joins', () => {
    const raw = normalizeBatchWords({ results: { items: [null, { type: 'pronunciation', alternatives: [{ content: 'hello' }] },
      { type: 'pronunciation', start_time: 'NaN', end_time: 'Infinity', alternatives: [{ content: 'bad' }] },
      { type: 'pronunciation', speaker_label: 'spk_0', start_time: '1', end_time: '2', alternatives: [{ content: 'conflict' }] }],
      speaker_labels: { segments: [{ speaker_label: 'spk_1', items: [{ start_time: '1', end_time: '2' }] }] } } })
    expect(raw.words[0]).toMatchObject({ start: null, end: null, speaker: null, confidence: null })
    expect(raw.words[1].start).toBeNull(); expect(raw.words[2].speaker).toBeNull()
    expect(normalizeBatchWords({ results: { speaker_labels: { segments: {} } } }).words).toEqual([])
  })
  it('streaming retains real word fields and incomplete status without invented confidence', () => {
    const result = normalizeStreamingWords([{ Type: 'pronunciation', Content: 'Hi', StartTime: 0, EndTime: .5, Speaker: 'a' }, { Type: 'punctuation', Content: '.' }], false)
    expect(result.complete).toBe(false)
    expect(result.words[0]).toMatchObject({ text: 'Hi.', start: 0, end: .5, confidence: null })
  })
  it('does not coerce arrays, blank values or objects into timing or transcript evidence', () => {
    const batch = normalizeBatchWords({ results: { items: [{ type: 'pronunciation', start_time: [], end_time: [1], alternatives: [{ content: {}, confidence: ' ' }] }] } })
    expect(batch.words[0]).toMatchObject({ text: '', start: null, end: null, confidence: null })
    const stream = normalizeStreamingWords([{ Type: 'pronunciation', Content: {}, StartTime: ' ', EndTime: {}, Confidence: [] }], true)
    expect(stream.words[0]).toMatchObject({ text: '', start: null, end: null, confidence: null })
  })
})
describe('Replay learner evidence', () => {
  it('does not label another speaker as the acknowledgement speaker in a preview', () => {
    const f = fixture([
      { id: 'ack', text: 'Yes.', start: 0, end: .2, speaker: 'spk_0', confidence: .99 },
      ...utterance('spk_1', .2, 10),
    ])
    const evidence = buildReplayEvidence(f.input, null, f.segments)
    expect(evidence.speakers.find(s => s.speaker === 'spk_0')).toBeUndefined()
    expect(evidence.speakers.find(s => s.speaker === 'spk_1')?.preview).toEqual({ start: .2, end: 5.2 })
    expect(evidence.speakers.find(s => s.speaker === 'spk_1')?.excerpt).toBe('word0 word1 word2 word3 word4 word5 word6 word7 word8 word9')
  })

  it('selects an identifying run and stops before another speaker or a long gap', () => {
    const f = fixture([
      ...utterance('spk_1', 0, 2),
      ...utterance('spk_0', 1, 4),
      ...utterance('spk_1', 5, 8),
      ...utterance('spk_0', 9, 8),
    ])
    const speaker = buildReplayEvidence(f.input, null, f.segments).speakers.find(s => s.speaker === 'spk_1')
    expect(speaker?.preview).toEqual({ start: 5, end: 9 })
    expect(speaker?.excerpt).toBe('word0 word1 word2 word3 word4 word5 word6 word7')
  })

  it('never treats dominant or single speaker as a confirmed learner', () => {
    const f = fixture()
    expect(buildReplayEvidence(f.input, null, f.segments).reason).toBe('confirm_learner')
    expect(calculateReplayMetrics(f.segments).wordsPerMinute).toBeNull()
    expect(findMatchingSpeaker(f.segments, '')).toBeNull()
    expect(selectionMatches({ ...f.selection, recordingSignature: 'different' }, f.input)).toBe(false)
    expect(selectionMatches({ ...f.selection, transcriptRevision: 'different' }, f.input)).toBe(false)
  })
  it('sums learner spans, excludes the other speaker and meeting elapsed time', () => {
    const f = fixture()
    const view = buildReplayEvidence(f.input, f.selection, f.segments)
    expect(view.pace.wpm).toBe(120)
    expect(view.eligibleWords).toBe(40)
    expect(view.coverage).toBe(1)
    expect(view.acousticIsolation).toBe('unknown')
    const changed = buildReplayEvidence(f.input, { ...f.selection, speaker: 'spk_0', revision: '2' }, f.segments)
    expect(changed.pace.wpm).toBeNull() // only one stretch
    expect(changed.moments).toEqual([])
  })
  it('weights unequal stretches by summed words and durations', () => {
    const f = fixture([...utterance('spk_1', 0, 10, .5), ...utterance('spk_0', 7, 8), ...utterance('spk_1', 20, 30, .75)])
    expect(buildReplayEvidence(f.input, f.selection, f.segments).pace.wpm).toBeCloseTo(40 / 27.5 * 60)
  })
  it('does not silently cap 280 WPM or turn an outlier into 250', () => {
    const f = fixture([...utterance('spk_1', 0, 28, 60 / 280), ...utterance('spk_1', 20, 28, 60 / 280)])
    expect(buildReplayEvidence(f.input, f.selection, f.segments).pace.wpm).toBeCloseTo(280)
    const fast = fixture([...utterance('spk_1', 0, 35, 60 / 350), ...utterance('spk_1', 20, 35, 60 / 350)])
    expect(buildReplayEvidence(fast.input, fast.selection, fast.segments).pace.wpm).toBeNull()
  })
  it('retains factual local gaps without claiming silence, quality, or emotion', () => {
    const words = utterance('spk_1', 0)
    for (const w of words.slice(8)) { w.start! += .8; w.end! += .8 }
    const f = fixture(words)
    const view = buildReplayEvidence(f.input, f.selection, f.segments)
    expect(view.pace.wpm).toBeNull()
    expect(view.moments).toHaveLength(1)
    expect(view.moments[0]).toMatchObject({ start: 2.5, end: 6.3, gapSeconds: expect.closeTo(.8) })
    expect(view.moments[0].description).toBe('0.8-second gap between transcribed words.')
    expect(view.moments[0].limitation).toContain('not verified silence')
  })
  it('rejects invalid boundaries and known overlap locally, with aggregate coverage gating', () => {
    const f = fixture()
    f.input.words!.words[5].end = 1000
    f.input.words!.words[6].start = NaN
    expect(buildReplayEvidence(f.input, f.selection, f.segments).pace.wpm).toBeNull()
    const overlap = fixture([...utterance('spk_1', 0), ...utterance('spk_0', 3, 2), ...utterance('spk_1', 30)])
    const v = buildReplayEvidence(overlap.input, overlap.selection, overlap.segments)
    expect(v.excludedWords).toBeGreaterThan(0)
    expect(v.moments.every(m => m.end <= 3 || m.start >= 4)).toBe(true)
  })
  it('incomplete provider stream cannot certify an aggregate', () => {
    const f = fixture(); f.input.words!.complete = false
    const view = buildReplayEvidence(f.input, f.selection, f.segments)
    expect(view.state).toBe('partial'); expect(view.pace.wpm).toBeNull()
  })
  it('does not describe another speaker inside a learner word gap as a learner pause', () => {
    const words = utterance('spk_1', 0)
    for (const w of words.slice(8)) { w.start! += .8; w.end! += .8 }
    words.push({ id: 'other', text: 'yes', start: 4.1, end: 4.4, speaker: 'spk_0', confidence: null })
    const f = fixture(words)
    expect(buildReplayEvidence(f.input, f.selection, f.segments).moments).toEqual([])
  })
  it('rejects changed words even when the count and all timestamps still look valid', () => {
    const f = fixture()
    f.input.words!.words[0].text = 'different'
    expect(buildReplayEvidence(f.input, f.selection, f.segments).reason).toBe('word_transcript_mismatch')
    f.input.words!.words = null as any
    expect(buildReplayEvidence(f.input, f.selection, f.segments).reason).toBe('word_evidence_malformed')
  })
  it('cue-only, text-only and old cache data cannot become measured by read-time migration', () => {
    const f = fixture()
    const legacy = legacyInput(f.segments, 'uploaded')
    expect(buildReplayEvidence(legacy, null, f.segments).reason).toBe('word_timing_missing_or_legacy')
    const v = replayResultView({ structuredTranscript: f.segments, wordsPerMinute: 150, speakingPercentage: 99, interruptionCount: 0, overallScore: 10,
      transcriptionSource: 'uploaded', strengths: [{ point: 'Clear agenda. Your pace is slow.' }], coachingInsights: { primaryImprovement: 'Slow down' } }, null)
    expect(v.result.wordsPerMinute).toBeNull(); expect(v.result.interruptionCount).toBeNull(); expect(v.result.overallScore).toBeNull()
    expect(v.result.strengths).toEqual([])
    expect(v.result.coachingInsights).toBeNull()
  })
  it('excludes timestamp or metadata labels and requires meaningful candidate evidence', () => {
    const segments = [
      { speaker: '00', text: 'Hello there' },
      { speaker: 'Meeting', text: 'Kickoff started now' },
      { speaker: 'Alice', text: 'We should align on goals today.' },
      { speaker: 'Alice', text: 'I can send a recap right after this call.' },
      { speaker: 'Bob', text: 'Yes' },
    ]
    expect(replaySpeakerCandidates(segments)).toEqual(['Alice'])
  })
  it('offers one unlabelled speaker when that is the only usable speech', () => {
    const enough = 'This recording has enough words to confirm a single speaker today.'
    const labelled = replaySpeakerResolution([{ speaker: 'Speaker', text: enough }])
    expect(labelled).toEqual({ candidates: ['Speaker'], speakerChoice: 'single_unlabelled' })
    const thin = replaySpeakerResolution([{ speaker: 'Speaker', text: 'Too short' }])
    expect(thin).toEqual({ candidates: [], speakerChoice: 'insufficient_labels' })
    expect(replaySpeakerResolution([
      { speaker: 'Alice', text: 'We should align on the delivery timeline today.' },
      { speaker: 'Speaker', text: enough },
    ]).speakerChoice).toBe('named')
  })
  it('keeps speaker confirmation below the assessment threshold', () => {
    const short = [
      { speaker: 'Alice', text: 'We should align on goals today.' },
      { speaker: 'Alice', text: 'I can send a recap.' },
    ]
    expect(replaySpeakerCandidates(short)).toEqual(['Alice'])
    expect(speakerMeetsAssessment(short, 'Alice')).toBe(false)
    const enough = [{ speaker: 'Alice', text: Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ') }]
    expect(speakerMeetsAssessment(enough, 'Alice')).toBe(true)
  })
  it('omits personalized fields structurally while learner identity is unconfirmed', () => {
    const segments = [{ speaker: 'Alice', text: 'I will share it tomorrow.' }]
    const row = {
      structuredTranscript: segments,
      transcriptionSource: 'uploaded',
      strengths: [{ point: 'Alice gave a clear summary.' }],
      improvements: [{ point: 'Ask Bob for confirmation.' }],
      recommendations: ['Have Alice close with owners.'],
      contextSpecificFeedback: [{ label: 'Ownership', detail: 'Alice owned next steps.' }],
      keyMoments: [{ text: 'Alice summarized outcomes', type: 'strength' }],
    }
    const view = replayResultView(row, null)
    expect(view.evidence.identity.state).toBe('confirmation_required')
    expect(view.result.strengths).toEqual([])
    expect(view.result.improvements).toEqual([])
    expect(view.result.recommendations).toEqual([])
    expect(view.result.contextSpecificFeedback).toEqual([])
    expect(view.result.keyMoments).toEqual([])
  })
  it('word share is words, never duration; competing uploaded words are not aligned', () => {
    const f = fixture(); f.input.supplementaryTranscript = { revision: 'vtt', status: 'different_not_aligned' }
    const v = replayResultView({ structuredTranscript: f.segments, deliveryEvidence: f.input }, f.selection)
    expect(v.result.wordShare).toBe(80)
    expect(v.result.speakingPercentage).toBeNull()
    expect(v.evidence.pace.wpm).toBe(120)
  })
  it('cache identity changes for recording, upload and source config', () => {
    const r = fixture().input.recording!
    expect(replayCacheKey(r, 'batch')).not.toBe(replayCacheKey({ ...r, signature: 'other' }, 'batch'))
    expect(replayCacheKey(r, 'batch')).not.toBe(replayCacheKey(r, 'stream'))
    expect(replayCacheKey(r, 'batch')).not.toBe(replayCacheKey({ ...r, uploadId: 'other' }, 'batch'))
    expect(neutralContent('Use an agenda. You sound nervous.')).toBe('Use an agenda.')
    const f = fixture(), key = replayCacheKey(r, 'batch')
    const cached = { cacheKey: key, fullText: 'cached', segments: f.segments, wordEvidence: f.input.words }
    expect(isReusableReplayCache(cached, key)).toBe(true)
    expect(isReusableReplayCache(cached, 'changed')).toBe(false)
    expect(isReusableReplayCache({ ...cached, wordEvidence: undefined }, key)).toBe(false)
    expect(isReusableReplayCache({ ...cached, wordEvidence: { ...cached.wordEvidence, version: 'old' } }, key)).toBe(false)
    expect(isReusableReplayCache({ ...cached, wordEvidence: { ...cached.wordEvidence, complete: false } }, key)).toBe(false)
    expect(isReusableReplayCache({ ...cached, segments: [null] }, key)).toBe(false)
  })
  it('invalidates identity and personal scores when displayed transcript revision changes', () => {
    const f = fixture(); f.input.analysisSelectionRevision = f.selection.revision
    f.segments[0].text += ' changed'
    const view = replayResultView({ structuredTranscript: f.segments, deliveryEvidence: f.input, skillScores: { scores: { clarity: 9 } } }, f.selection)
    expect(view.evidence.reason).toBe('transcript_revision_mismatch')
    expect(view.evidence.identity.state).toBe('confirmation_required')
    expect(view.result.overallScore).toBeNull(); expect(view.skillScores).toBeNull(); expect(view.result.wordShare).toBeNull()
  })
  it('does not expose raw score envelopes, unsupported keys or invalid score values', () => {
    const f = fixture(); f.input.analysisSelectionRevision = f.selection.revision
    const view = replayResultView({ structuredTranscript: f.segments, deliveryEvidence: f.input,
      skillScores: { signals: { private: 'SECRET' }, scores: { clarity: 8, confidence: 99, engagement: NaN, extra: 'SECRET', delivery: 9 }, components: { clarity: { okay: 1, private: 'SECRET' } } } }, f.selection)
    expect(view.skillScores?.scores.clarity).toBe(8)
    expect(view.skillScores?.scores.confidence).toBeNull(); expect(view.skillScores?.scores.engagement).toBeNull()
    expect(view.skillScores?.scores.delivery).toBeNull()
    expect(JSON.stringify(view)).not.toContain('SECRET')
  })
  it('fails closed for malformed legacy segments and duplicate word IDs', () => {
    expect(replayResultView({ structuredTranscript: [null, { text: 1 }] }, null).result.overallScore).toBeNull()
    const f = fixture(); f.input.words!.words[1].id = f.input.words!.words[0].id
    expect(buildReplayEvidence(f.input, f.selection, f.segments).reason).toBe('word_evidence_malformed')
  })
  it('does not let an impossible word span invalidate unrelated later speech', () => {
    const words = [...utterance('spk_1', 0, 30), ...utterance('spk_1', 30, 30)]
    for (const w of words.slice(40)) { w.start! += .8; w.end! += .8 }
    const f = fixture(words); f.input.words!.words[0].end = 1000
    const view = buildReplayEvidence(f.input, f.selection, f.segments)
    expect(view.eligibleWords).toBe(59)
    expect(view.moments).toHaveLength(1)
    expect(view.pace.wpm).not.toBeNull()
  })
})
