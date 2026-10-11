import { createHash } from 'crypto'
import { z } from 'zod'

// Independent of Replay analysis and live voice settings. Changes require a new ID.
export const CONFIGS = {
  nova2_lite: { id: 'nova2-lite-pilot-1', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite' },
  nova_pro: { id: 'nova-pro-comparison-1', modelId: 'amazon.nova-pro-v1:0', region: 'us-east-1', label: 'Nova Pro (comparison)' },
} as const
export const VERSIONS = { prompt: 'interview-answer-4', schema: 'interview-result-2', rubric: 'bank-guidance-1', policy: 'adaptive-1' } as const
export const LIMITS = { dailyPerAdmin: 20, dailyGlobal: 100, concurrent: 2, attempts: 3, timeoutMs: 20_000, leaseMs: 60_000, maxTokens: 2000 }
export const submitSchema = z.object({
  questionId: z.string().min(1).max(160), revision: z.number().int().positive(),
  answer: z.string().trim().min(1).max(8000), source: z.literal('ADMIN_TEST').default('ADMIN_TEST'),
  model: z.enum(['nova2_lite', 'nova_pro']).default('nova2_lite'),
  assistance: z.enum(['NONE', 'HINT', 'EXAMPLE']).default('NONE'), language: z.literal('en').default('en'),
}).strict()
export const questionSnapshotSchema = z.object({
  id: z.string(), namespace: z.string(), externalQid: z.string(), revision: z.number().int(),
  questionText: z.string(), track: z.string(), category: z.string(), topic: z.string(), difficulty: z.string(), experienceBand: z.string(),
  goodAnswerPoints: z.string(), exampleAnswer: z.string(), expectedDepth: z.string(), followUpGuidance: z.string(),
}).strict()
export type QuestionSnapshot = z.infer<typeof questionSnapshotSchema>
const text = z.string().trim().min(1).max(1400)
const criterionSchema = z.object({
  criterion: z.enum(['ACCURACY', 'REASONING', 'DEPTH']),
  finding: z.enum(['MET', 'PARTIAL', 'NOT_MET', 'NOT_ASSESSED']),
  evidence: z.array(text).max(3), explanation: text,
}).strict()
export const resultSchema = z.object({
  classification: z.enum(['CORRECT', 'PARTIAL', 'INCORRECT', 'NOT_ANSWERED']),
  criteria: z.array(criterionSchema).length(3), strengths: z.array(text).max(6), gaps: z.array(text).max(6),
  misconceptions: z.array(text).max(6), guidance: text, uncertainty: z.array(text).max(4),
  followUpQuestion: z.string().trim().max(1200),
}).strict()
// Server-owned notes describe validation adjustments; the model cannot supply them.
export type EvaluationResult = z.infer<typeof resultSchema> & { validationNotes?: string[] }
export function hash(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, canonical(item)])) : v
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
export function configFor(model: keyof typeof CONFIGS) {
  return { ...CONFIGS[model], ...VERSIONS, temperature: 0, maxTokens: LIMITS.maxTokens, timeoutMs: LIMITS.timeoutMs }
}
export function parseResult(output: string, answer: string): EvaluationResult {
  const result = resultSchema.parse(JSON.parse(output.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '')))
  if (new Set(result.criteria.map(c => c.criterion)).size !== 3) throw new Error('INVALID_CRITERIA')
  const validationNotes: string[] = []
  for (const criterion of result.criteria) {
    if (criterion.finding !== 'NOT_ASSESSED' && !criterion.evidence.length) {
      // Missing reasoning/depth is not evidence of a false claim. Remove only the
      // unsupported negative finding, without inventing a quote or changing the verdict.
      if (criterion.finding !== 'NOT_MET' || criterion.criterion === 'ACCURACY') throw new Error('MISSING_EVIDENCE')
      const label = criterion.criterion === 'DEPTH' ? 'Answer depth' : 'Reasoning'
      criterion.finding = 'NOT_ASSESSED'
      criterion.explanation = 'The model did not provide supporting evidence for this finding. This criterion is left unassessed.'
      validationNotes.push(`${label}: the model returned Needs improvement without evidence. The finding was changed to Not established; no evidence was invented.`)
    }
    if (criterion.evidence.some(quote => !answer.includes(quote))) throw new Error('UNSUPPORTED_EVIDENCE')
  }
  if (result.classification !== 'NOT_ANSWERED' && !result.followUpQuestion.endsWith('?')) throw new Error('INVALID_FOLLOW_UP')
  return validationNotes.length ? { ...result, validationNotes } : result
}
export const ACTIONS = { CORRECT: 'DEEPEN', PARTIAL: 'CLARIFY', INCORRECT: 'SIMPLIFY', NOT_ANSWERED: 'SWITCH_TOPIC' } as const
export function explicitDontKnow(answer: string) {
  return /^(?:i\s+(?:do not|don't|don’t)\s+know|i(?:'m| am)\s+not\s+sure|no\s+idea|pass|skip)(?:[.!?]|\s)*$/i.test(answer.trim())
}
