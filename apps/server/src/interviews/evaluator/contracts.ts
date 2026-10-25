import { createHash } from 'crypto'
import { z } from 'zod'

// Independent of Replay analysis and live voice settings. Changes require a new ID.
export const CONFIGS = {
  nova2_lite: { id: 'nova2-lite-pilot-1', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite' },
  nova_pro: { id: 'nova-pro-comparison-1', modelId: 'amazon.nova-pro-v1:0', region: 'us-east-1', label: 'Nova Pro (comparison)' },
} as const
export const VERSIONS = { prompt: 'interview-answer-4', schema: 'interview-result-2', rubric: 'bank-guidance-1', policy: 'adaptive-1' } as const
export const LIMITS = { dailyPerAdmin: 20, dailyGlobal: 100, concurrent: 2, attempts: 3, timeoutMs: 20_000, leaseMs: 60_000, maxTokens: 2000 }
export type EvaluatorConfig = { id: string; modelId: string; region: string; label: string; prompt: string; schema: string; rubric: string; policy: string
  temperature: number; maxTokens: number; timeoutMs: number }
// Learner grading policies are frozen literals: a run pins one at launch and keeps evaluating
// with exactly that entry. Never edit an entry in place; add a version and move CURRENT.
// learner-evaluation-1 reproduces configFor('nova2_lite') as first pinned (hash checked in tests).
export const LEARNER_POLICIES: Record<string, { config: EvaluatorConfig; deterministicAbstention: boolean }> = {
  'learner-evaluation-1': { deterministicAbstention: false, config: { id: 'nova2-lite-pilot-1', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite',
    prompt: 'interview-answer-4', schema: 'interview-result-2', rubric: 'bank-guidance-1', policy: 'adaptive-1', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  'learner-evaluation-2': { deterministicAbstention: true, config: { id: 'nova2-lite-learner-2', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · learner grading 2',
    prompt: 'interview-answer-5', schema: 'interview-result-3', rubric: 'bank-guidance-2', policy: 'learner-evaluation-2', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
}
export const CURRENT_LEARNER_POLICY = 'learner-evaluation-1'
// Admins can preview a learner policy through the accounted Admin test path. learner-evaluation-1
// is byte-identical to nova2_lite, so only policies with their own configuration are offered.
export const PREVIEW_POLICIES = Object.keys(LEARNER_POLICIES).filter(key =>
  !Object.keys(CONFIGS).some(model => hash(configFor(model as keyof typeof CONFIGS)) === hash(LEARNER_POLICIES[key].config)))
export const ADMIN_MODELS = [...Object.keys(CONFIGS), ...PREVIEW_POLICIES] as [string, ...string[]]
export function adminConfig(model: string): EvaluatorConfig {
  return PREVIEW_POLICIES.includes(model) ? LEARNER_POLICIES[model].config : configFor(model as keyof typeof CONFIGS)
}
/** The previewed learner policy for a stored Admin test config, if it is one. */
export function previewPolicy(config: unknown) {
  const key = PREVIEW_POLICIES.find(k => hash(LEARNER_POLICIES[k].config) === hash(config))
  return key ? { key, ...LEARNER_POLICIES[key] } : null
}
/** The registered configuration equal to a persisted one, or null for retired/arbitrary configs. */
export function supportedConfig(config: unknown): EvaluatorConfig | null {
  const key = hash(config)
  return [...Object.keys(CONFIGS).map(k => configFor(k as keyof typeof CONFIGS)), ...Object.values(LEARNER_POLICIES).map(p => p.config)]
    .find(c => hash(c) === key) ?? null
}
export const submitSchema = z.object({
  questionId: z.string().min(1).max(160), revision: z.number().int().positive(),
  answer: z.string().trim().min(1).max(8000), source: z.literal('ADMIN_TEST').default('ADMIN_TEST'),
  model: z.enum(ADMIN_MODELS).default('nova2_lite'),
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
export function configFor(model: keyof typeof CONFIGS): EvaluatorConfig {
  return { ...CONFIGS[model], ...VERSIONS, temperature: 0, maxTokens: LIMITS.maxTokens, timeoutMs: LIMITS.timeoutMs }
}
// interview-result-3 (learner) ignores follow-ups, which the learner path never uses, and rejects
// grades whose classification contradicts their own criteria instead of publishing them.
export function parseResult(output: string, answer: string, schema = 'interview-result-2'): EvaluationResult {
  const raw: unknown = JSON.parse(output.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, ''))
  const learner = schema === 'interview-result-3'
  const validationNotes: string[] = []
  const result = resultSchema.parse(learner && raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...trimLists(raw as Record<string, unknown>, validationNotes), followUpQuestion: '' } : raw)
  if (new Set(result.criteria.map(c => c.criterion)).size !== 3) throw new Error('INVALID_CRITERIA')
  for (const criterion of result.criteria) {
    if (criterion.finding !== 'NOT_ASSESSED' && !criterion.evidence.length) {
      // Missing reasoning/depth is not evidence of a false claim. Remove only the
      // unsupported negative finding, without inventing a quote or changing the verdict.
      // A learner abstention has no accuracy to establish, so its unquoted NOT_MET is removed too.
      const repairable = criterion.criterion !== 'ACCURACY' || (learner && result.classification === 'NOT_ANSWERED')
      if (criterion.finding !== 'NOT_MET' || !repairable) throw new Error('MISSING_EVIDENCE')
      if (criterion.criterion === 'ACCURACY') { criterion.finding = 'NOT_ASSESSED'; criterion.explanation = 'No subject understanding was demonstrated in this answer.'; continue }
      const label = criterion.criterion === 'DEPTH' ? 'Answer depth' : 'Reasoning'
      criterion.finding = 'NOT_ASSESSED'
      criterion.explanation = 'The model did not provide supporting evidence for this finding. This criterion is left unassessed.'
      validationNotes.push(`${label}: the model returned Needs improvement without evidence. The finding was changed to Not established; no evidence was invented.`)
    }
    if (criterion.evidence.some(quote => !answer.includes(quote))) throw new Error('UNSUPPORTED_EVIDENCE')
  }
  if (!learner && result.classification !== 'NOT_ANSWERED' && !result.followUpQuestion.endsWith('?')) throw new Error('INVALID_FOLLOW_UP')
  if (learner) {
    const accuracy = result.criteria.find(c => c.criterion === 'ACCURACY')!.finding
    const consistent = result.classification === 'CORRECT' ? accuracy === 'MET' && !result.misconceptions.length
      : result.classification === 'PARTIAL' ? ['MET', 'PARTIAL'].includes(accuracy)
      : result.classification === 'INCORRECT' ? accuracy === 'NOT_MET' && result.misconceptions.length > 0
      : result.criteria.every(c => c.finding === 'NOT_ASSESSED') && !result.strengths.length && !result.misconceptions.length
    if (!consistent) throw new Error('INCONSISTENT')
  }
  return validationNotes.length ? { ...result, validationNotes } : result
}
// Learner grades keep the first allowed items when the model returns longer lists (for example
// more than three quotations for an answer with many false claims). Kept quotes are still checked
// as exact; nothing is invented or reworded.
const LIST_LIMITS = { strengths: 6, gaps: 6, misconceptions: 6, uncertainty: 4 } as const
function trimLists(raw: Record<string, unknown>, notes: string[]) {
  let trimmed = false
  const cap = (value: unknown, limit: number) => Array.isArray(value) && value.length > limit ? (trimmed = true, value.slice(0, limit)) : value
  const out: Record<string, unknown> = { ...raw }
  for (const [key, limit] of Object.entries(LIST_LIMITS)) out[key] = cap(raw[key], limit)
  if (Array.isArray(raw.criteria)) out.criteria = raw.criteria.map(c => c && typeof c === 'object' && !Array.isArray(c)
    ? { ...c, evidence: cap((c as Record<string, unknown>).evidence, 3) } : c)
  if (trimmed) notes.push('The evaluator returned more items than the report shows; only the first ones were kept.')
  return out
}
/** Bounded, content-free failure reason: schema keys and Zod issue codes only, never output text. */
export function invalidOutputReason(error: unknown) {
  if (error instanceof SyntaxError) return 'INVALID_OUTPUT_JSON'
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]
    const path = issue?.path.filter(p => typeof p === 'string').join('_')
    return `INVALID_OUTPUT_SCHEMA${path ? `_${path}` : ''}_${issue?.code ?? 'unknown'}`.slice(0, 80)
  }
  return error instanceof Error && ['INVALID_CRITERIA', 'MISSING_EVIDENCE', 'UNSUPPORTED_EVIDENCE', 'INVALID_FOLLOW_UP', 'INCONSISTENT'].includes(error.message)
    ? `INVALID_OUTPUT_${error.message}` : 'INVALID_OUTPUT'
}
/** bank-guidance-2: the bank's labelled goodAnswerPoints sections as separate rubric fields. */
export function structuredRubric(question: QuestionSnapshot) {
  const labels = { 'core': 'requiredPoints', 'acceptable alternatives': 'acceptedAlternatives', 'optional depth': 'optionalDepth', 'misconceptions': 'commonMisconceptions' } as const
  const sections: Record<(typeof labels)[keyof typeof labels], string[]> = { requiredPoints: [], acceptedAlternatives: [], optionalDepth: [], commonMisconceptions: [] }
  let current: keyof typeof sections = 'requiredPoints'
  for (const line of question.goodAnswerPoints.split('\n')) {
    const match = /^\s*(core|acceptable alternatives|optional depth|misconceptions)\s*:\s*(.*)$/i.exec(line)
    if (match) current = labels[match[1].toLowerCase() as keyof typeof labels]
    const content = (match ? match[2] : line).trim()
    if (content) sections[current].push(content)
  }
  const join = (items: string[]) => items.join('\n')
  return { requiredPoints: join(sections.requiredPoints), acceptedAlternatives: join(sections.acceptedAlternatives), optionalDepth: join(sections.optionalDepth),
    commonMisconceptions: join(sections.commonMisconceptions), exampleAnswer: question.exampleAnswer, expectedDepth: question.expectedDepth }
}
export const ACTIONS = { CORRECT: 'DEEPEN', PARTIAL: 'CLARIFY', INCORRECT: 'SIMPLIFY', NOT_ANSWERED: 'SWITCH_TOPIC' } as const
export function explicitDontKnow(answer: string) {
  return /^(?:i\s+(?:do not|don't|don’t)\s+know|i(?:'m| am)\s+not\s+sure|no\s+idea|pass|skip)(?:[.!?]|\s)*$/i.test(answer.trim())
}
// Policies with deterministicAbstention recognise these whole-answer abstentions (optionally with
// filler or courtesy words) without a model call. Anything with technical content goes to the model.
const FILLER = String.raw`(?:um+|uh+|hmm+|so|well|okay|ok|sorry|honestly|actually)`
const ABSTAIN = String.raw`(?:i\s+(?:do\s+not|don't|don’t|dont)\s+know(?:\s+(?:this|that|the\s+answer|this\s+one|that\s+one))?|i(?:'m|’m|\s+am)\s+not\s+sure(?:\s+(?:about\s+)?(?:this|that|this\s+one))?|not\s+sure|(?:i\s+have\s+)?no\s+(?:idea|clue)|i\s+(?:can't|can’t|cannot)\s+answer(?:\s+(?:this|that))?|pass|skip)`
// Trailing alternatives must stay disjoint from FILLER, and the length cap bounds backtracking:
// a whole-answer abstention is short, and anything longer goes to the model.
const ABSTENTION = new RegExp(String.raw`^(?:${FILLER}[\s,.]+)*${ABSTAIN}(?:[\s,.]+(?:${FILLER}|at\s+all))*[\s.!?…]*$`, 'i')
export function explicitAbstention(answer: string) { const text = answer.trim(); return text.length <= 160 && ABSTENTION.test(text) }
/** Server-authored outcome for a deterministic abstention; no model output is involved. */
export function abstentionResult(): EvaluationResult {
  const explanation = 'No subject understanding was demonstrated in this answer.'
  return { classification: 'NOT_ANSWERED', followUpQuestion: '', strengths: [], gaps: [], misconceptions: [], uncertainty: [],
    criteria: (['ACCURACY', 'REASONING', 'DEPTH'] as const).map(criterion => ({ criterion, finding: 'NOT_ASSESSED' as const, evidence: [], explanation })),
    guidance: 'You indicated that you do not know this answer. Review the concept before trying again.',
    validationNotes: ['Recognised as an explicit "I don\'t know". No model evaluation was used.'] }
}
