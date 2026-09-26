import type { SessionReport } from '@/lib/generate-session-pdf'
import type { ReplayResultData } from '@/hooks/useReplaySession'
/** Same allowlisted display data as the page: never resurrect legacy numeric columns. */
export function replayEvidenceReport(data: ReplayResultData): SessionReport {
  const { evidence, result } = data
  return {
    title: data.session.sessionName || data.session.meetingType, subtitle: 'Replay delivery evidence', source: 'replay',
    metadata: [{ label: 'Learner', value: evidence.identity.speaker ?? 'Not confirmed' }, { label: 'Timing', value: 'Model-estimated; not human-validated' },
      { label: 'Role', value: data.session.userRole }, { label: 'Meeting type', value: data.session.meetingType },
      ...(data.session.meetingDate ? [{ label: 'Meeting date', value: data.session.meetingDate.slice(0, 10) }] : [])],
    overallScore: data.result.overallScore, skillScores: data.skillScores ?? null, progressPulse: null,
    metrics: [{ section: 'Delivery evidence', items: [
      { label: 'Speaking pace', value: evidence.pace.wpm == null ? 'Not available' : `${Math.round(evidence.pace.wpm)} WPM (model-timed)` },
      { label: 'Word share (not speaking time)', value: result.wordShare == null ? 'Not available' : `${result.wordShare}%` },
      { label: 'Interruptions', value: 'Not assessed' },
    ] }, { section: 'Selected-speaker transcript measurements', items: [
      { label: 'Filler count', value: result.fillerWordCount == null ? 'Not available' : String(result.fillerWordCount) },
      { label: 'Filler rate', value: result.fillerWordRate == null ? 'Not available' : `${result.fillerWordRate}%` },
      { label: 'Hedging rate', value: result.hedgingRate == null ? 'Not available' : `${result.hedgingRate}%` },
      { label: 'Average sentence length', value: result.avgSentenceLength == null ? 'Not available' : `${result.avgSentenceLength} words` },
      { label: 'Vocabulary diversity', value: result.vocabularyDiversity == null ? 'Not available' : `${result.vocabularyDiversity}%` },
      { label: 'Questions asked', value: result.questionsAsked == null ? 'Not available' : String(result.questionsAsked) },
    ] }],
    transcript: data.transcriptHidden ? undefined : result.transcriptText,
    structuredTranscript: data.transcriptHidden ? undefined : result.structuredTranscript.map(s => ({ speaker: s.speaker, text: s.text ?? '' })),
    strengths: result.strengths,
    improvements: result.improvements,
    coachingInsights: data.coachingInsights,
    recommendations: result.recommendations,
    contextSpecificFeedback: result.contextSpecificFeedback,
    summary: result.feedbackScope,
  }
}
