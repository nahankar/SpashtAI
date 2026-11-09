import type { EvaluationResult } from './contracts'

// Shadow policy only: no live selection, state mutation, model call or generated question.
// A caller must supply capture provenance. Missing ASR confidence alone is not incomplete capture;
// unknown capture integrity stays UNKNOWN. Release/feature gates remain outside this shadow policy.
export type RoutingInput =
  | { kind: 'CONTROL'; control: 'REPEAT' | 'SKIP' | 'PAUSE' | 'DECLINE' }
  | { kind: 'ASSESSMENT'; transcript: 'COMPLETE' | 'INCOMPLETE' | 'UNKNOWN'; status: string;
      errorCode?: string | null; result?: EvaluationResult | null }
export type RoutingAction = 'HOLD' | 'REPEAT_QUESTION' | 'NEXT_QUESTION' | 'PAUSE' | 'NEXT_TOPIC'
  | 'CLARIFY_RESPONSE' | 'DEEPEN' | 'CLARIFY' | 'SIMPLIFY'
export type RoutingDecision = { action: RoutingAction; updateKnowledge: boolean; reason: string }
export function assessmentRouting(input: RoutingInput): RoutingDecision {
  const hold = (reason: string): RoutingDecision => ({ action: 'HOLD', updateKnowledge: false, reason })
  if (input.kind === 'CONTROL') {
    const actions = { REPEAT: 'REPEAT_QUESTION', SKIP: 'NEXT_QUESTION', PAUSE: 'PAUSE', DECLINE: 'NEXT_TOPIC' } as const
    return actions[input.control] ? { action: actions[input.control], updateKnowledge: false, reason: 'LEARNER_CONTROL' } : hold('CONTROL_INTENT_REQUIRED')
  }
  if (input.transcript !== 'COMPLETE') return hold('TRANSCRIPT_UNAVAILABLE')
  if (input.status !== 'COMPLETED' || input.errorCode || !input.result) return hold('ASSESSMENT_UNAVAILABLE')
  const result = input.result
  if (result.assessmentIssues?.length) return hold('ASSESSMENT_CONFLICT')
  if (result.responseKind === 'REQUEST_ONLY') return hold('CONTROL_INTENT_REQUIRED')
  if (result.responseKind === 'DONT_KNOW' && result.classification !== 'NOT_ANSWERED') return hold('ASSESSMENT_CONFLICT')
  if (result.responseKind === 'DONT_KNOW') return { action: 'NEXT_TOPIC', updateKnowledge: false, reason: 'DECLINED' }
  if (result.classification === 'NOT_ANSWERED') return { action: 'CLARIFY_RESPONSE', updateKnowledge: false, reason: 'NO_SUBJECT_EVIDENCE' }
  const actions = { CORRECT: 'DEEPEN', PARTIAL: 'CLARIFY', INCORRECT: 'SIMPLIFY' } as const
  return actions[result.classification] ? { action: actions[result.classification], updateKnowledge: true, reason: 'USABLE_ASSESSMENT' } : hold('ASSESSMENT_UNAVAILABLE')
}
