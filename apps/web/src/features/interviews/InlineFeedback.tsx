import type { ChatMessage } from '@/features/live-session/types'
import { InterviewFeedbackDisclosure, InterviewFeedbackPlaceholder } from './InterviewFeedbackDisclosure'
import type { useInterviewFindings } from './useInterviewFindings'

/**
 * The feedback line below one learner answer, for the practice page and playback alike. Space is reserved
 * from the first render so results arriving never move the page; association is by attempt id only.
 */
export function inlineFeedback(message: ChatMessage, findings: ReturnType<typeof useInterviewFindings>) {
  if (message.role !== 'user' || !message.attemptId) return null
  if (!findings.loaded) return <InterviewFeedbackPlaceholder />
  if (findings.error) return <InterviewFeedbackPlaceholder text="Technical feedback · Could not load" />
  return <InterviewFeedbackDisclosure finding={findings.byAttempt.get(message.attemptId)} />
}
