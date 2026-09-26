import { describe, expect, it } from 'vitest'
import { replayEvidenceReport } from './evidence-report'
import type { ReplayResultData } from '../../hooks/useReplaySession'

describe('Replay report allowlist', () => {
  function fixture() {
    return {
      session: { sessionName: 'Meeting', meetingType: 'Review' },
      evidence: { identity: { speaker: null }, pace: { wpm: null } },
      result: { overallScore: null, wordShare: null, wordsPerMinute: 150, speakingPercentage: 90, interruptionCount: 0,
        transcriptText: 'Private text', structuredTranscript: [{ speaker: 'a', text: 'Private text' }],
        strengths: [{ point: 'Clear agenda' }], improvements: [], recommendations: [], contextSpecificFeedback: [], feedbackScope: 'Unattributed content' },
      skillScores: null, coachingInsights: { meetingSummary: { topicsDiscussed: ['Plan'] } },
    } as unknown as ReplayResultData
  }
  it('does not reconstruct score, pace, time share or interruption claims from legacy columns', () => {
    const report = replayEvidenceReport(fixture())
    expect(report.overallScore).toBeNull()
    expect(report.skillScores).toBeNull()
    expect(report.progressPulse).toBeNull()
    expect(report.metrics?.[0].items).toEqual([
      { label: 'Speaking pace', value: 'Not available' },
      { label: 'Word share (not speaking time)', value: 'Not available' },
      { label: 'Interruptions', value: 'Not assessed' },
    ])
    expect(report.strengths).toEqual([{ point: 'Clear agenda' }])
  })
  it('preserves export restrictions and uses canonical model-timed pace', () => {
    const data = fixture()
    data.transcriptHidden = true
    data.evidence.pace.wpm = 123.4
    data.evidence.identity.speaker = 'spk_1'
    data.result.wordShare = 30
    const report = replayEvidenceReport(data)
    expect(report.transcript).toBeUndefined()
    expect(report.structuredTranscript).toBeUndefined()
    expect(report.metrics?.[0].items[0].value).toBe('123 WPM (model-timed)')
    expect(report.metrics?.[0].items[1].value).toBe('30%')
  })
})
