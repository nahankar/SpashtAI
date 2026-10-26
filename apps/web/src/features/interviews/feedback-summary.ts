import { outcomeLabel } from '@/lib/interview-evaluator'
import { PENDING_FINDING, type LearnerFinding } from './useInterviewFindings'

/** Summary text for an answer's feedback, or null when there is none to show (not enabled, skipped). */
export function feedbackSummary(finding: LearnerFinding | undefined): string | null {
  if (!finding) return null
  if (finding.status === 'COMPLETED' && finding.result) return `Technical feedback · ${outcomeLabel(finding.result)}`
  if (PENDING_FINDING.includes(finding.status)) return 'Technical feedback · Evaluating…'
  if (['FAILED', 'CANCELLED'].includes(finding.status)) return 'Technical feedback · Unavailable'
  if (finding.status === 'INCOMPLETE') return 'Incomplete answer · not evaluated'
  // Speech saved before a Skip stays in the transcript; it is never graded.
  if (finding.status === 'SKIPPED') return 'Skipped · not evaluated'
  // Kept as a line (not removed) so the reserved space below each answer never collapses after loading.
  if (finding.status === 'NOT_ENABLED') return 'Technical feedback · Not enabled for this practice'
  return null
}

