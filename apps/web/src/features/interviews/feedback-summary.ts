import { outcomeLabel } from '@/lib/interview-evaluator'
import { PENDING_FINDING, type LearnerFinding } from './useInterviewFindings'

/** Summary text for an answer's feedback, or null when there is none to show (not enabled, skipped). */
/** Why feedback is unavailable for an answer, by cause (never a grade). Saved answers and recordings are unaffected. */
export type UnavailableReason = 'after_practice' | 'user_budget' | 'shared_budget' | 'budget' | 'service' | 'not_enabled' | 'transcript'
export function unavailableReason(finding: LearnerFinding): UnavailableReason | null {
  if (finding.status === 'AFTER_PRACTICE') return 'after_practice'
  if (finding.status === 'TRANSCRIPT_INCOMPLETE' || finding.errorCode === 'TRANSCRIPT_INCOMPLETE') return 'transcript'
  if (finding.errorCode === 'EVALUATION_USER_BUDGET_REACHED') return 'user_budget'
  if (finding.errorCode === 'EVALUATION_SHARED_BUDGET_REACHED') return 'shared_budget'
  // Recorded before the two limits were reported separately: it may have been either.
  if (finding.errorCode === 'EVALUATION_BUDGET_REACHED') return 'budget'
  if (finding.status === 'CANCELLED' && ['PILOT_ACCESS_UNAVAILABLE', 'EVALUATOR_POLICY_UNAVAILABLE'].includes(finding.errorCode ?? '')) return 'not_enabled'
  if (['FAILED', 'CANCELLED'].includes(finding.status)) return 'service'
  return null
}
export const UNAVAILABLE_SUMMARY: Record<UnavailableReason, string> = {
  after_practice: 'Technical feedback · Available after practice ends',
  user_budget: 'Technical feedback · Your daily evaluation limit was reached',
  shared_budget: 'Technical feedback · Shared daily evaluation limit was reached',
  budget: 'Technical feedback · A daily evaluation limit was reached',
  service: 'Technical feedback · Evaluation service unavailable',
  not_enabled: 'Technical feedback · Not enabled for this practice',
  transcript: 'Not assessed · Part of this answer was not transcribed',
}
export const UNAVAILABLE_DETAIL: Record<UnavailableReason, string> = {
  after_practice: 'Technical feedback appears here after you end the practice. Pausing does not end it.',
  user_budget: 'Your daily limit for technical evaluations (each evaluation and retry counts) was reached before this answer, so it was not evaluated.',
  shared_budget: 'The daily evaluation limit shared by all learners was reached before this answer, so it was not evaluated. This is not your personal allowance.',
  budget: 'A daily evaluation limit was reached before this answer, so it was not evaluated.',
  service: 'The evaluation service could not complete this answer. No grade was invented.',
  not_enabled: 'Technical evaluation was not enabled for this answer.',
  transcript: 'Speech recognition missed part of this answer, so it was not graded: a missing transcript is not evidence of a knowledge gap, and this is not a judgement of your answer.',
}

/** Summary text for an answer's feedback, or null when there is none to show (not enabled, skipped). */
export function feedbackSummary(finding: LearnerFinding | undefined): string | null {
  if (!finding) return null
  if (finding.status === 'COMPLETED' && finding.result) return `Technical feedback · ${outcomeLabel(finding.result)}`
  if (PENDING_FINDING.includes(finding.status)) return 'Technical feedback · Evaluating…'
  const reason = unavailableReason(finding)
  if (reason) return UNAVAILABLE_SUMMARY[reason]
  if (finding.status === 'INCOMPLETE') return 'Incomplete answer · not evaluated'
  // Speech saved before a Skip stays in the transcript; it is never graded.
  if (finding.status === 'SKIPPED') return 'Skipped · not evaluated'
  // Kept as a line (not removed) so the reserved space below each answer never collapses after loading.
  if (finding.status === 'NOT_ENABLED') return 'Technical feedback · Not enabled for this practice'
  return null
}

/** Playback warning for an answer whose transcript is incomplete: an estimate of untranscribed speech, never words. */
export function transcriptWarning(finding: LearnerFinding): string | null {
  const t = finding.transcriptIntegrity
  if (!t) return null
  const parts: string[] = []
  if (t.gapSpeechSeconds > 0) parts.push(`about ${Math.max(1, Math.round(t.gapSpeechSeconds))} seconds of speech could not be transcribed`)
  if (t.unresolved) parts.push('speech recognition stopped responding and did not recover during this answer')
  if (t.unconfirmedAccepted) parts.push('it was saved without speech that had not been transcribed yet')
  const what = parts.length ? `${parts.join('; ')}.` : 'part of it could not be transcribed.'
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} ${t.recordingAvailable ? 'The recording of this answer was saved; listen to it in playback.' : 'No saved recording was confirmed for this answer.'}`
}
