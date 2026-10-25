export const EVALUATOR_API = '/api/admin/interview-evaluator'
export interface EvaluatorConfig {
  accessible: boolean; calibrated: boolean; usedToday: number; costUsd: number | null
  unreportedUsage: number
  // id is the configuration identity; learner-policy previews share a modelId with nova2_lite.
  models: { key: string; id: string; label: string; modelId: string; region: string }[]
  limits: { dailyPerAdmin: number; attempts: number }
  usage: { _count: number; _sum: { inputTokens: number | null; outputTokens: number | null } }
}
export interface Assessment {
  id: string; status: string; attempts: number; errorCode: string | null; bankChanged: boolean; afterExample: boolean; configCurrent: boolean; createdAt: string
  config: { id: string; label: string; modelId: string; region: string; prompt: string; schema: string; rubric: string; policy: string }
  snapshot: { answerText: string; assistance: string; source: string; textSource: string; textRevision: number;
    questionSnapshot: { externalQid: string; questionText: string; revision: number; track: string; topic: string; difficulty: string } }
  usage: { id: string; latencyMs: number; inputTokens: number | null; outputTokens: number | null; outcome: string }[]
  result: null | {
    classification: string; strengths: string[]; gaps: string[]; misconceptions: string[]; guidance: string; uncertainty: string[]; validationNotes?: string[]
    responseKind?: ResponseKind
    criteria: { criterion: string; finding: string; explanation: string; evidence: string[] }[]
    // Null for learner-policy previews, which grade the answer without proposing a next step.
    next: { action: string; source: string; questionText: string | null; topic: string | null; needsReview: boolean } | null
  }
}
export interface TestList { tests: { id: string; status: string; createdAt: string; snapshot: { assistance: string } }[] }
export const labels: Record<string, string> = {
  CORRECT: 'Correct', PARTIAL: 'Partially correct', INCORRECT: 'Incorrect', NOT_ANSWERED: 'No technical answer',
  ACCURACY: 'Technical accuracy', REASONING: 'Reasoning', DEPTH: 'Answer depth', MET: 'Demonstrated',
  NOT_MET: 'Needs improvement', NOT_ASSESSED: 'Not established', DEEPEN: 'Go deeper', CLARIFY: 'Clarify a gap', SIMPLIFY: 'Try a simpler question', SWITCH_TOPIC: 'Change topic',
  PENDING: 'Queued', RUNNING: 'Evaluating', COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled',
}
// learner-evaluation-4+ distinguish a request to repeat/skip from an explicit "I don't know"; older
// assessments have no responseKind and keep their classification label.
export type ResponseKind = 'REQUEST_ONLY' | 'DONT_KNOW'
export const RESPONSE_KIND_LABELS: Record<ResponseKind, string> = { REQUEST_ONLY: 'Request only · no answer to assess', DONT_KNOW: 'Did not know' }
export function outcomeLabel(result: { classification: string; responseKind?: ResponseKind }) {
  return result.responseKind ? RESPONSE_KIND_LABELS[result.responseKind] : labels[result.classification] ?? result.classification
}
export function isTestPending(status?: string) { return status === 'PENDING' || status === 'RUNNING' }
