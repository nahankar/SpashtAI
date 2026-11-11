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
  temperature: number; maxTokens: number; timeoutMs: number; responseFormat?: 'tool'; reasoningEffort?: 'low' | 'medium' }
// Learner grading policies are frozen literals: a run pins one at launch and keeps evaluating
// with exactly that entry. Never edit an entry in place; add a version and move CURRENT.
// learner-evaluation-1 reproduces configFor('nova2_lite') as first pinned (hash checked in tests).
// deterministicRequests (v4+): a whole answer that only asks to repeat, skip, pause or move on is a request,
// not an abstention, and results carry a server-owned responseKind.
export type LearnerPolicy = { config: EvaluatorConfig; deterministicAbstention: boolean; deterministicRequests?: boolean }
export const LEARNER_POLICIES: Record<string, LearnerPolicy> = {
  'learner-evaluation-1': { deterministicAbstention: false, config: { id: 'nova2-lite-pilot-1', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite',
    prompt: 'interview-answer-4', schema: 'interview-result-2', rubric: 'bank-guidance-1', policy: 'adaptive-1', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  'learner-evaluation-2': { deterministicAbstention: true, config: { id: 'nova2-lite-learner-2', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · learner grading 2',
    prompt: 'interview-answer-5', schema: 'interview-result-3', rubric: 'bank-guidance-2', policy: 'learner-evaluation-2', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  'learner-evaluation-3': { deterministicAbstention: true, config: { id: 'nova2-lite-learner-3', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · learner grading 3',
    prompt: 'interview-answer-6', schema: 'interview-result-3', rubric: 'bank-guidance-2', policy: 'learner-evaluation-3', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  // Measured, not adopted: still described a stated reason as missing reasoning (pilot Q1).
  'learner-evaluation-4': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-4', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · learner grading 4',
    prompt: 'interview-answer-7', schema: 'interview-result-3', rubric: 'bank-guidance-2', policy: 'learner-evaluation-4', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  // bank-guidance-3 adds statedReasons: exact passages of the answer that state a cause or purpose.
  'learner-evaluation-5': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-5', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · learner grading 5',
    prompt: 'interview-answer-8', schema: 'interview-result-3', rubric: 'bank-guidance-3', policy: 'learner-evaluation-5', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  // Measured, not adopted: stopped over-crediting false or empty reasons but then credited no reasoning at all.
  'learner-evaluation-6': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-6', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · learner grading 6',
    prompt: 'interview-answer-9', schema: 'interview-result-3', rubric: 'bank-guidance-3', policy: 'learner-evaluation-6', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  // Measured, not adopted: removed false 'no reasoning' wording but still missed pilot-2 Q6/Q7/Q8 and over-credited RS-01.
  'learner-evaluation-7': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-7', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · learner grading 7',
    prompt: 'interview-answer-10', schema: 'interview-result-3', rubric: 'bank-guidance-3', policy: 'learner-evaluation-7', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  // Benchmark only (never current): learner-evaluation-5's exact prompt, schema and rubric on Nova Pro, so a
  // comparison with v5 isolates the model.
  'learner-evaluation-5-nova-pro': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova-pro-learner-5', modelId: 'amazon.nova-pro-v1:0', region: 'us-east-1', label: 'Nova Pro · learner grading 5 (benchmark)',
    prompt: 'interview-answer-8', schema: 'interview-result-3', rubric: 'bank-guidance-3', policy: 'learner-evaluation-5-nova-pro', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  // Current: learner-evaluation-5 with interview-result-4 evidence matching (whitespace-only differences mapped
  // back to the original passage). Same prompt, rubric and model: grading semantics are unchanged.
  'learner-evaluation-8': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-8', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · learner grading 8',
    prompt: 'interview-answer-8', schema: 'interview-result-4', rubric: 'bank-guidance-3', policy: 'learner-evaluation-8', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  // Benchmark only (never current): learner-evaluation-8 on Nova Pro.
  'learner-evaluation-8-nova-pro': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova-pro-learner-8', modelId: 'amazon.nova-pro-v1:0', region: 'us-east-1', label: 'Nova Pro · learner grading 8 (benchmark)',
    prompt: 'interview-answer-8', schema: 'interview-result-4', rubric: 'bank-guidance-3', policy: 'learner-evaluation-8-nova-pro', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  // Preview only: claim-level judgments with a server-derived verdict. Not current until semantic validation.
  'learner-evaluation-9': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-9', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · learner grading 9 (candidate)',
    prompt: 'interview-answer-11', schema: 'interview-result-5', rubric: 'bank-guidance-4', policy: 'learner-evaluation-9', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  // Preview only: addresses measured complete-answer/gap conflicts and attempted technical statements.
  'learner-evaluation-10': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-10', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · learner grading 10 (candidate)',
    prompt: 'interview-answer-12', schema: 'interview-result-5', rubric: 'bank-guidance-4', policy: 'learner-evaluation-10', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  'learner-evaluation-11': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-11', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · learner grading 11 (candidate)',
    prompt: 'interview-answer-13', schema: 'interview-result-6', rubric: 'bank-guidance-5', policy: 'learner-evaluation-11', temperature: 0, maxTokens: 2000, timeoutMs: 20_000 } },
  'learner-evaluation-12': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-12', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · learner grading 12 (candidate)',
    prompt: 'interview-answer-14', schema: 'interview-result-6', rubric: 'bank-guidance-5', policy: 'learner-evaluation-12', temperature: 0, maxTokens: 2000, timeoutMs: 20_000, responseFormat: 'tool' } },
  'learner-evaluation-13': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-13', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · compact grading 13 (candidate)',
    prompt: 'interview-answer-15', schema: 'interview-result-7', rubric: 'bank-guidance-6', policy: 'learner-evaluation-13', temperature: 0, maxTokens: 2000, timeoutMs: 20_000, responseFormat: 'tool' } },
  'learner-evaluation-14': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-14', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · separated grading 14 (candidate)',
    prompt: 'interview-answer-16', schema: 'interview-result-8', rubric: 'bank-guidance-6', policy: 'learner-evaluation-14', temperature: 0, maxTokens: 2000, timeoutMs: 20_000, responseFormat: 'tool' } },
  'learner-evaluation-14-budget-control': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-14-budget-control', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · grading 14 matched-budget control',
    prompt: 'interview-answer-16', schema: 'interview-result-8', rubric: 'bank-guidance-6', policy: 'learner-evaluation-14-budget-control', temperature: 0, maxTokens: 15000, timeoutMs: 40_000, responseFormat: 'tool' } },
  'learner-evaluation-14-thinking-low': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-14-thinking-low', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · grading 14 low thinking (comparison)',
    prompt: 'interview-answer-16', schema: 'interview-result-8', rubric: 'bank-guidance-6', policy: 'learner-evaluation-14-thinking-low', temperature: 0, maxTokens: 15000, timeoutMs: 40_000, responseFormat: 'tool', reasoningEffort: 'low' } },
  // Inactive preview: declared interpretation uncertainty is a server-enforced no-grade gate.
  'learner-evaluation-15': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-15', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · interpretation-first grading 15 (candidate)',
    prompt: 'interview-answer-17', schema: 'interview-result-9', rubric: 'bank-guidance-6', policy: 'learner-evaluation-15', temperature: 0, maxTokens: 15000, timeoutMs: 40_000, responseFormat: 'tool', reasoningEffort: 'low' } },

  // Parser-only preview: identical v15 model request; presentation summary cannot gate an assessment.
  'learner-evaluation-16': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-16', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · review boundary 16 (candidate)',
    prompt: 'interview-answer-17', schema: 'interview-result-10', rubric: 'bank-guidance-6', policy: 'learner-evaluation-16', temperature: 0, maxTokens: 15000, timeoutMs: 40_000, responseFormat: 'tool', reasoningEffort: 'low' } },

  // Measured benchmark, rejected for promotion (11 Nov 2026); retained for historical config support.
  // Identical grading instructions/validation/bounds to v16; changes LOW to MEDIUM.
  'learner-evaluation-16-thinking-medium': { deterministicAbstention: true, deterministicRequests: true, config: { id: 'nova2-lite-learner-16-thinking-medium', modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1', label: 'Nova 2 Lite · grading 16 medium thinking (benchmark)',
    prompt: 'interview-answer-17', schema: 'interview-result-10', rubric: 'bank-guidance-6', policy: 'learner-evaluation-16-thinking-medium', temperature: 0, maxTokens: 15000, timeoutMs: 40_000, responseFormat: 'tool', reasoningEffort: 'medium' } },

}
// learner-evaluation-8: v5's prompt, rubric and model with the versioned interview-result-4 evidence matching.
// Technical grading remains experimental (reasoning, mixed-answer strengths and no-answer classification are open).
export const CURRENT_LEARNER_POLICY = 'learner-evaluation-8'
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
// Server-owned notes describe validation adjustments; the model cannot supply them. responseKind (v4+)
// distinguishes a request to repeat/skip from an explicit "I don't know"; both are NOT_ANSWERED.
export type ResponseKind = 'REQUEST_ONLY' | 'DONT_KNOW'
export type AssessmentIssue = 'REASONING_CONFLICT' | 'REASONING_INVALID_OUTPUT'
export type EvaluationResult = z.infer<typeof resultSchema> & { validationNotes?: string[]; responseKind?: ResponseKind; assessmentIssues?: AssessmentIssue[] }
export function hash(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, canonical(item)])) : v
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
export function configFor(model: keyof typeof CONFIGS): EvaluatorConfig {
  return { ...CONFIGS[model], ...VERSIONS, temperature: 0, maxTokens: LIMITS.maxTokens, timeoutMs: LIMITS.timeoutMs }
}
/**
 * interview-result-4 evidence matching: a quotation is accepted only when its exact characters appear as one
 * contiguous passage of the answer, allowing nothing but whitespace (spaces, line breaks between transcript
 * fragments) to differ. The stored quote becomes that original passage. Case, punctuation, changed, removed or
 * reordered words are still rejected. Returns null when there is no such passage.
 */
export function originalPassage(answer: string, quote: string): string | null {
  if (answer.includes(quote)) return quote
  const tokens = quote.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return null
  const pattern = new RegExp(tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
  return pattern.exec(answer)?.[0] ?? null
}
// interview-result-3 (learner) ignores follow-ups, which the learner path never uses, and rejects
// grades whose classification contradicts their own criteria instead of publishing them.
// interview-result-4 is result-3 with whitespace-tolerant evidence matching (originalPassage).
export function parseResult(output: string, answer: string, schema = 'interview-result-2'): EvaluationResult {
  const raw: unknown = JSON.parse(output.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, ''))
  if (schema === 'interview-result-5') return parseClaimResult(raw, answer)
  if (schema === 'interview-result-10') return parseReviewBoundaryResult(raw, answer)
  if (schema === 'interview-result-9') return parseInterpretationFirstResult(raw, answer)
  if (schema === 'interview-result-8') return parseSeparatedResult(raw, answer)
  if (schema === 'interview-result-7') return parseCompactResult(raw, answer)
  if (schema === 'interview-result-6') return parseInterpretedClaimResult(raw, answer)
  const tolerant = schema === 'interview-result-4'
  const learner = schema === 'interview-result-3' || tolerant
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
    if (tolerant) {
      const passages = criterion.evidence.map(quote => originalPassage(answer, quote))
      if (passages.some(passage => passage === null)) throw new Error('UNSUPPORTED_EVIDENCE')
      criterion.evidence = passages as string[]
    } else if (criterion.evidence.some(quote => !answer.includes(quote))) throw new Error('UNSUPPORTED_EVIDENCE')
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

// v5 keeps claim judgments separate from the overall verdict. The model still judges meaning;
// deriving the verdict prevents logical contradictions, not semantic misjudgments.
const claimResultSchema = z.object({
  claims: z.array(z.object({
    quote: text, judgment: z.enum(['CORRECT', 'INCORRECT', 'EMPTY']),
    scope: z.enum(['CENTRAL', 'SECONDARY']), reasoning: z.enum(['VALID', 'PARTIAL', 'INVALID', 'NONE']),
    explanation: text,
  }).strict()).max(6),
  coverage: z.enum(['COMPLETE', 'INCOMPLETE', 'NONE']),
  depth: criterionSchema.omit({ criterion: true }),
  gaps: z.array(text).max(6), guidance: text, uncertainty: z.array(text).max(4),
}).strict()

const interpretedClaimResultSchema = claimResultSchema.extend({
  reviewRequired: z.boolean(),
  claims: z.array(claimResultSchema.shape.claims.element.extend({
    interpretedClaim: z.string().trim().min(1).max(400),
    interpretation: z.enum(['LITERAL', 'NORMALIZED', 'UNCERTAIN']),
  }).strict()).max(6),
}).strict()
class EvaluationReviewRequired extends Error { constructor() { super('EVALUATION_REVIEW_REQUIRED') } }

function parseInterpretedClaimResult(raw: unknown, answer: string): EvaluationResult {
  const ledger = interpretedClaimResultSchema.parse(raw)
  for (const claim of ledger.claims) if (!originalPassage(answer, claim.quote)) throw new Error('UNSUPPORTED_EVIDENCE')
  if (ledger.reviewRequired || ledger.claims.some(c => c.interpretation === 'UNCERTAIN')) {
    if (!ledger.uncertainty.length) throw new Error('INCONSISTENT')
    // There is no classification to publish or use for routing. The saved answer remains intact.
    throw new EvaluationReviewRequired()
  }
  const { reviewRequired: _, claims, ...rest } = ledger
  const result = parseClaimResult({ ...rest, claims: claims.map(({ interpretedClaim: _meaning, interpretation: _kind, ...claim }) => claim) }, answer)
  const notes = claims.filter(c => c.interpretation === 'NORMALIZED').slice(0, 2)
    .map(c => `Transcription interpretation: “${originalPassage(answer, c.quote)}” was understood as “${c.interpretedClaim}”. The original transcript was not changed.`)
  return notes.length ? { ...result, validationNotes: [...(result.validationNotes ?? []), ...notes] } : result
}

// Deterministic evidence addressing. Every returned passage is copied from the saved answer.
// The full transcript is still supplied; these boundaries do not decide technical meaning.
export function answerPassages(answer: string): { id: number; text: string }[] {
  const passages: { id: number; text: string }[] = []
  for (const match of answer.matchAll(/[^.!?\n]+[.!?]*/g)) {
    for (let offset = 0; offset < match[0].length; offset += 1000) {
      // submitSchema limits answers to 8000 chars; reserving eight slots retains the tail.
      if (passages.length === 120) {
        const tail = answer.slice(match.index + offset)
        for (let start = 0; start < tail.length; start += 1000) {
          const text = tail.slice(start, start + 1000).trim()
          if (text) passages.push({ id: passages.length + 1, text })
        }
        return passages
      }
      const text = match[0].slice(offset, offset + 1000).trim()
      if (text) passages.push({ id: passages.length + 1, text })
    }
  }
  return passages
}

const passageIds = z.array(z.number().int().min(1).max(128)).max(6)
const compactGradeSchema = z.object({
  decision: z.enum(['COMPLETE', 'INCOMPLETE', 'FALSE_CORE', 'NO_SUBJECT', 'REVIEW']),
  correct: passageIds, incorrect: passageIds, reasoning: passageIds,
  reviewReason: z.unknown().optional(), feedback: z.unknown().optional(),
}).strict()
const compactFeedbackSchema = z.object({ gaps: z.array(text).max(6).optional(),
  strengths: z.array(text).max(6).optional(), misconceptions: z.array(text).max(6).optional(), guidance: text.optional() }).strict()
function parseCompactResult(raw: unknown, answer: string): EvaluationResult {
  const grade = compactGradeSchema.parse(raw)
  const passages = answerPassages(answer)
  for (const ids of [grade.correct, grade.incorrect, grade.reasoning]) {
    if (new Set(ids).size !== ids.length || ids.some(id => !passages.some(p => p.id === id))) throw new Error('INVALID_PASSAGE_REFERENCE')
  }
  if (grade.reasoning.some(id => !grade.correct.includes(id))) throw new Error('INCONSISTENT')
  if (grade.decision === 'REVIEW' || grade.decision === 'NO_SUBJECT') {
    if (grade.correct.length || grade.incorrect.length || grade.reasoning.length) throw new Error('INCONSISTENT')
    if (grade.decision === 'REVIEW') {
      if (!z.string().trim().min(1).max(800).safeParse(grade.reviewReason).success) throw new Error('INVALID_REVIEW_REASON')
      throw new EvaluationReviewRequired()
    }
    return { ...abstentionResult(), guidance: 'No assessable technical claim was established. Explain the requested concept in your own words.',
      validationNotes: ['No subject proposition was established; this is not evidence of an incorrect belief.'] }
  }
  if (grade.decision === 'COMPLETE' && (!grade.correct.length || grade.incorrect.length)
    || grade.decision === 'INCOMPLETE' && !grade.correct.length
    || grade.decision === 'FALSE_CORE' && !grade.incorrect.length) throw new Error('INCONSISTENT')
  const classification = grade.decision === 'COMPLETE' ? 'CORRECT' : grade.decision === 'INCOMPLETE' ? 'PARTIAL' : 'INCORRECT'
  const quote = (ids: number[], limit = 6) => ids.slice(0, limit).map(id => passages[id - 1].text)
  // Optional presentation is independently validated. Missing/malformed prose cannot alter a grade.
  const parsedFeedback = compactFeedbackSchema.safeParse(grade.feedback)
  const feedback = parsedFeedback.success ? parsedFeedback.data : {}
  const result = { classification, followUpQuestion: '', uncertainty: [],
    criteria: [
      { criterion: 'ACCURACY', finding: classification === 'CORRECT' ? 'MET' : classification === 'PARTIAL' ? 'PARTIAL' : 'NOT_MET',
        evidence: quote(classification === 'INCORRECT' ? grade.incorrect : [...new Set([...grade.correct, ...grade.incorrect])], 3),
        explanation: classification === 'CORRECT' ? 'The cited answer covers the requested essentials.' : classification === 'PARTIAL'
          ? 'Relevant understanding is present, with missing essentials or mixed claims.' : 'The cited answer contains a false claim about the requested core concept.' },
      { criterion: 'REASONING', finding: grade.reasoning.length ? 'MET' : 'NOT_ASSESSED', evidence: quote(grade.reasoning, 3),
        explanation: grade.reasoning.length ? 'The cited passage explains a relevant mechanism, contrast or consequence.' : 'No valid subject explanation was established.' },
      { criterion: 'DEPTH', finding: 'NOT_ASSESSED', evidence: [], explanation: 'This compact assessment does not assess optional depth.' },
    ], strengths: feedback.strengths?.length ? feedback.strengths : quote(grade.correct),
    misconceptions: grade.incorrect.length ? (feedback.misconceptions?.length ? feedback.misconceptions : quote(grade.incorrect)) : [],
    gaps: classification === 'CORRECT' ? [] : feedback.gaps ?? [],
    guidance: feedback.guidance ?? (classification === 'CORRECT' ? 'Apply this understanding to a different example.' : 'Review the requested distinction and explain your reasoning.'),
  }
  const validated = parseResult(JSON.stringify(result), answer, 'interview-result-4')
  return !parsedFeedback.success && grade.feedback !== undefined ? { ...validated, validationNotes: [...(validated.validationNotes ?? []), 'Detailed feedback was unavailable; the assessment uses the cited original passages.'] } : validated
}

// v8 retains a structurally valid primary verdict when a separate reasoning assessment fails.
// Server-owned issues prevent that partial result being mistaken for an adaptive-ready assessment.
const separatedGradeSchema = compactGradeSchema.omit({ reasoning: true }).extend({
  validReasoning: z.unknown().optional(), invalidReasoning: z.unknown().optional(),
}).strict()
function parseSeparatedResult(raw: unknown, answer: string): EvaluationResult {
  const grade = separatedGradeSchema.parse(raw)
  const { validReasoning, invalidReasoning, ...coreInput } = grade
  // Reuse the frozen v7 core/evidence/presentation guards; do not fabricate or upgrade a decision.
  const core = parseCompactResult({ ...coreInput, reasoning: [] }, answer)
  const notes = [...(core.validationNotes ?? [])]
  const issues: AssessmentIssue[] = []
  const ids = z.object({ valid: passageIds, invalid: passageIds }).safeParse({
    valid: validReasoning === undefined ? [] : validReasoning,
    invalid: invalidReasoning === undefined ? [] : invalidReasoning,
  })
  const passages = answerPassages(answer)
  if (grade.decision === 'NO_SUBJECT' && ids.success && (ids.data.valid.length || ids.data.invalid.length)) throw new Error('INCONSISTENT')
  let valid: number[] = [], invalid: number[] = []
  if (!ids.success || [ids.data.valid, ids.data.invalid].some(items => new Set(items).size !== items.length || items.some(id => !passages[id - 1]))) {
    issues.push('REASONING_INVALID_OUTPUT')
    notes.push('The reasoning assessment was invalid and is left unassessed. The separate knowledge verdict was retained; adaptive progression is on hold.')
  } else if (ids.data.valid.some(id => !grade.correct.includes(id)) || ids.data.invalid.some(id => !grade.incorrect.includes(id))) {
    issues.push('REASONING_CONFLICT')
    notes.push('The reasoning assessment conflicts with the knowledge evidence and is left unassessed. The knowledge verdict was not changed; adaptive progression is on hold.')
  } else { valid = ids.data.valid; invalid = ids.data.invalid }
  if (grade.decision === 'NO_SUBJECT' && (valid.length || invalid.length)) throw new Error('INCONSISTENT')
  const finding = valid.length ? (invalid.length ? 'PARTIAL' : 'MET') : invalid.length ? 'NOT_MET' : 'NOT_ASSESSED'
  const evidence = [...new Set([...valid, ...invalid])].slice(0, 3).map(id => passages[id - 1].text)
  const { validationNotes: _notes, ...publicCore } = core
  const validated = parseResult(JSON.stringify({ ...publicCore, criteria: core.criteria.map(c => c.criterion !== 'REASONING' ? c : {
    criterion: 'REASONING', finding, evidence, explanation: finding === 'MET' ? 'The cited passage explains a true relevant mechanism, contrast or consequence.'
      : finding === 'PARTIAL' ? 'The answer contains both valid and false explanations.' : finding === 'NOT_MET'
      ? 'The cited passage contains an explicitly false explanation; this is separate from the knowledge verdict.' : 'No valid reasoning assessment was established.',
  }) }), answer, 'interview-result-4')
  return { ...validated, ...(notes.length ? { validationNotes: notes } : {}), ...(issues.length ? { assessmentIssues: issues } : {}) }
}

// v9 makes the interpretation check and reasoning review explicit. These are model judgments,
// not verified ASR provenance. The server can enforce declared uncertainty, not detect hidden mistakes.
const interpretationFirstSchema = separatedGradeSchema.extend({
  interpretation: z.object({ status: z.enum(['CLEAR', 'NORMALIZED', 'UNCERTAIN']),
    summary: z.string().trim().min(1).max(400), evidence: passageIds }).strict(),
  validReasoning: passageIds, invalidReasoning: passageIds,
}).strict()
function parseInterpretationFirstResult(raw: unknown, answer: string): EvaluationResult {
  const { interpretation, ...grade } = interpretationFirstSchema.parse(raw)
  const passages = answerPassages(answer)
  for (const ids of [interpretation.evidence, grade.correct, grade.incorrect, grade.validReasoning, grade.invalidReasoning]) {
    if (new Set(ids).size !== ids.length || ids.some(id => !passages[id - 1])) throw new Error('INVALID_PASSAGE_REFERENCE')
  }
  if (interpretation.status !== 'CLEAR' && !interpretation.evidence.length) throw new Error('INVALID_PASSAGE_REFERENCE')
  // Even a contradictory COMPLETE/FALSE_CORE must not publish a grade when meaning is uncertain.
  if (interpretation.status === 'UNCERTAIN') throw new EvaluationReviewRequired()
  return parseSeparatedResult(grade, answer)
}

// v10 separates non-grade-bearing prose from the safety decision. The provider-facing schema
// stays unchanged; malformed summaries are discarded, never repaired, quoted, logged or persisted.
const reviewBoundarySchema = interpretationFirstSchema.extend({
  interpretation: interpretationFirstSchema.shape.interpretation.extend({ summary: z.unknown().optional() }).strict(),
}).strict()
function parseReviewBoundaryResult(raw: unknown, answer: string): EvaluationResult {
  const { interpretation, ...grade } = reviewBoundarySchema.parse(raw)
  const passages = answerPassages(answer)
  for (const ids of [interpretation.evidence, grade.correct, grade.incorrect, grade.validReasoning, grade.invalidReasoning]) {
    if (new Set(ids).size !== ids.length || ids.some(id => !passages[id - 1])) throw new Error('INVALID_PASSAGE_REFERENCE')
  }
  if (interpretation.status !== 'CLEAR' && !interpretation.evidence.length) throw new Error('INVALID_PASSAGE_REFERENCE')
  // Required status and all source references must pass before we honor an ungraded review.
  if (interpretation.status === 'UNCERTAIN') throw new EvaluationReviewRequired()
  const result = parseSeparatedResult(grade, answer)
  const summary = interpretationFirstSchema.shape.interpretation.shape.summary.safeParse(interpretation.summary)
  return summary.success ? result : { ...result, validationNotes: [...(result.validationNotes ?? []),
    'The interpretation summary was unavailable; only the validated status and original source references were used.'] }
}

// Content-free diagnostics only: keep the same rejection/message, never include provider text.
const CLAIM_REASONS = ['DEPTH_UNASSESSED_EVIDENCE', 'TRUTH_REASONING_CONFLICT', 'DUPLICATE_PASSAGE',
  'EMPTY_WITH_COVERAGE', 'CORRECT_WITH_NO_COVERAGE', 'COMPLETE_WITHOUT_CORE', 'CORRECT_WITH_GAPS',
  'EMPTY_WITH_ASSESSED_DEPTH'] as const
class ClaimValidationError extends Error {
  constructor(public reason: typeof CLAIM_REASONS[number], message = 'INCONSISTENT') { super(message) }
}

function parseClaimResult(raw: unknown, answer: string): EvaluationResult {
  const ledger = claimResultSchema.parse(raw)
  if (ledger.depth.finding === 'NOT_ASSESSED' && ledger.depth.evidence.length) throw new ClaimValidationError('DEPTH_UNASSESSED_EVIDENCE')
  const claims = ledger.claims.map(c => {
    const passage = originalPassage(answer, c.quote)
    if (!passage) throw new Error('UNSUPPORTED_EVIDENCE')
    if ((c.judgment === 'EMPTY' && c.reasoning !== 'NONE')
      || (c.judgment === 'CORRECT' && c.reasoning === 'INVALID')
      || (c.judgment === 'INCORRECT' && ['VALID', 'PARTIAL'].includes(c.reasoning))) throw new ClaimValidationError('TRUTH_REASONING_CONFLICT')
    return { ...c, quote: passage }
  })
  if (new Set(claims.map(c => c.quote)).size !== claims.length) throw new ClaimValidationError('DUPLICATE_PASSAGE', 'INVALID_CRITERIA')
  const correct = claims.filter(c => c.judgment === 'CORRECT')
  const falseClaims = claims.filter(c => c.judgment === 'INCORRECT')
  const substantive = correct.length + falseClaims.length > 0
  if (!substantive && ledger.coverage !== 'NONE') throw new ClaimValidationError('EMPTY_WITH_COVERAGE')
  if (correct.length && ledger.coverage === 'NONE') throw new ClaimValidationError('CORRECT_WITH_NO_COVERAGE')
  const correctCentral = correct.some(c => c.scope === 'CENTRAL')
  if (ledger.coverage === 'COMPLETE' && !correctCentral) throw new ClaimValidationError('COMPLETE_WITHOUT_CORE')
  const classification = !substantive ? 'NOT_ANSWERED'
    : (falseClaims.some(c => c.scope === 'CENTRAL') && !correctCentral) || !correct.length ? 'INCORRECT'
    : falseClaims.length || ledger.coverage !== 'COMPLETE' ? 'PARTIAL' : 'CORRECT'
  if (classification === 'CORRECT' && ledger.gaps.length) throw new ClaimValidationError('CORRECT_WITH_GAPS')
  if (!substantive && ledger.depth.finding !== 'NOT_ASSESSED') throw new ClaimValidationError('EMPTY_WITH_ASSESSED_DEPTH')
  const reasons = claims.filter(c => c.reasoning !== 'NONE')
  const valid = reasons.filter(c => ['VALID', 'PARTIAL'].includes(c.reasoning))
  const invalid = reasons.filter(c => c.reasoning === 'INVALID')
  const unassessed = 'No supporting subject evidence was established for this criterion.'
  const quotations = (items: typeof claims) => [...new Set(items.map(c => c.quote))].slice(0, 3)
  const accuracyEvidence = classification === 'INCORRECT' ? falseClaims : [...correct, ...falseClaims]
  const accuracyFinding = classification === 'CORRECT' ? 'MET' : classification === 'PARTIAL' ? 'PARTIAL'
    : classification === 'INCORRECT' ? 'NOT_MET' : 'NOT_ASSESSED'
  const reasoningFinding = !reasons.length ? 'NOT_ASSESSED' : !valid.length ? 'NOT_MET'
    : invalid.length || valid.some(c => c.reasoning === 'PARTIAL') ? 'PARTIAL' : 'MET'
  const result = {
    classification, criteria: [
      { criterion: 'ACCURACY', finding: accuracyFinding, evidence: quotations(accuracyEvidence),
        explanation: classification === 'PARTIAL' ? 'Some relevant understanding was demonstrated, with essential gaps or a false claim.'
          : substantive ? (classification === 'INCORRECT' ? falseClaims[0] : correct[0]).explanation : unassessed },
      { criterion: 'REASONING', finding: reasoningFinding, evidence: quotations(reasons),
        explanation: reasoningFinding === 'PARTIAL' ? 'The explanation includes valid reasoning alongside false or incomplete reasoning.'
          : reasons.length ? reasons[0].explanation : unassessed },
      { criterion: 'DEPTH', ...ledger.depth },
    ], strengths: correct.map(c => c.explanation), misconceptions: falseClaims.map(c => c.explanation),
    gaps: substantive ? ledger.gaps : [], guidance: ledger.guidance, uncertainty: ledger.uncertainty, followUpQuestion: '',
  }
  // Reuse the existing evidence/shape/consistency boundary after normalizing to the public result contract.
  return parseResult(JSON.stringify(result), answer, 'interview-result-4')
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
  if (error instanceof EvaluationReviewRequired) return 'EVALUATION_REVIEW_REQUIRED'
  if (error instanceof ClaimValidationError) return `INVALID_OUTPUT_CLAIM_${error.reason}`
  if (error instanceof SyntaxError) return 'INVALID_OUTPUT_JSON'
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]
    const path = issue?.path.filter(p => typeof p === 'string').join('_')
    return `INVALID_OUTPUT_SCHEMA${path ? `_${path}` : ''}_${issue?.code ?? 'unknown'}`.slice(0, 80)
  }
  return error instanceof Error && ['INVALID_CRITERIA', 'MISSING_EVIDENCE', 'UNSUPPORTED_EVIDENCE', 'INVALID_FOLLOW_UP', 'INCONSISTENT', 'INVALID_PASSAGE_REFERENCE', 'INVALID_REVIEW_REASON'].includes(error.message)
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
// Sentences or transcript lines that state a cause, purpose or consequence, copied exactly from the answer.
// They only point the model at reasoning the learner gave; the model still judges whether it is valid.
const REASON_MARKER = /\b(?:because|since|so that|in order to|therefore|which means|that's why|that is why|otherwise|due to)\b/i
export function statedReasons(answer: string): string[] {
  return (answer.match(/[^.!?\n]+[.!?]*/g) ?? []).map(part => part.trim()).filter(part => part && REASON_MARKER.test(part)).slice(0, 6)
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
export function abstentionResult(tagged = false): EvaluationResult {
  const explanation = 'No subject understanding was demonstrated in this answer.'
  return { classification: 'NOT_ANSWERED', followUpQuestion: '', strengths: [], gaps: [], misconceptions: [], uncertainty: [],
    criteria: (['ACCURACY', 'REASONING', 'DEPTH'] as const).map(criterion => ({ criterion, finding: 'NOT_ASSESSED' as const, evidence: [], explanation })),
    guidance: 'You indicated that you do not know this answer. Review the concept before trying again.',
    validationNotes: ['Recognised as an explicit "I don\'t know". No model evaluation was used.'], ...(tagged ? { responseKind: 'DONT_KNOW' as const } : {}) }
}
// Whole-answer requests to repeat, skip, pause or move on (spoken controls are not supported yet).
// Anchored at both ends and length-capped: a request inside a technical answer never matches, so that
// answer is graded normally. Nothing is executed; the learner uses the buttons.
const COURTESY = String.raw`(?:um+|uh+|hmm+|so|well|okay|ok|sorry|actually|please|thanks|thank\s+you|excuse\s+me)`
const AGAIN = String.raw`(?:\s+(?:again|one\s+more\s+time|once\s+more))?`
const ASKING = String.raw`(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:can|could|may)\s+(?:i|we)\s+(?:please\s+)?|(?:let'?s|let\s+us|i(?:'d|\s+would)\s+like\s+to|i\s+want\s+to|please)\s+)?`
const REQUEST = String.raw`(?:${ASKING}(?:repeat|say|read)(?:\s+(?:that|the|this|it))?(?:\s+question)?${AGAIN}|${ASKING}(?:hear|have)\s+(?:that|the|this|it)(?:\s+question)?${AGAIN}|what\s+was\s+the\s+question|come\s+again|pardon(?:\s+me)?|i\s+(?:didn't|did\s+not|couldn't|could\s+not)\s+(?:catch|hear|get)\s+(?:that|the\s+question|it)|${ASKING}(?:skip|pass\s+on)(?:\s+(?:this|that|the))?(?:\s+(?:one|question))?|${ASKING}(?:move|go)\s+on(?:\s+to\s+the\s+next(?:\s+(?:one|question))?)?|${ASKING}(?:move|go)\s+to\s+the\s+next(?:\s+(?:one|question))?|(?:the\s+)?next\s+question|${ASKING}(?:pause|take\s+a\s+(?:short\s+)?break)(?:\s+(?:here|for\s+a\s+(?:moment|minute|second)))?)`
const REQUEST_ONLY = new RegExp(String.raw`^(?:${COURTESY}[\s,.!]+)*${REQUEST}(?:[\s,.!?]+(?:(?:and|then)\s+)?${REQUEST})*(?:[\s,.!]+${COURTESY})*[\s.!?…]*$`, 'i')
export function requestOnly(answer: string) { const text = answer.trim().replace(/’/g, "'"); return text.length <= 160 && REQUEST_ONLY.test(text) }
/** Server-authored outcome for a request-only answer: no assessable evidence and no knowledge deficit implied. */
export function requestResult(): EvaluationResult {
  const explanation = 'The response asked to repeat, skip or pause the question; it contains no technical answer to assess.'
  return { classification: 'NOT_ANSWERED', followUpQuestion: '', strengths: [], gaps: [], misconceptions: [], uncertainty: [],
    criteria: (['ACCURACY', 'REASONING', 'DEPTH'] as const).map(criterion => ({ criterion, finding: 'NOT_ASSESSED' as const, evidence: [], explanation })),
    guidance: 'This response was a request rather than an answer, so it says nothing about your knowledge. Spoken requests are not supported yet: use Repeat question or Skip question.',
    validationNotes: ['Recognised as a request to repeat, skip or pause. No model evaluation was used.'], responseKind: 'REQUEST_ONLY' }
}
/** The model-free outcome a learner policy gives an answer, if any (same rule for learners and Admin previews). */
export function deterministicResult(policy: LearnerPolicy | null | undefined, answer: string): EvaluationResult | null {
  if (!policy) return null
  if (policy.deterministicRequests && requestOnly(answer)) return requestResult()
  if (policy.deterministicAbstention && explicitAbstention(answer)) return abstentionResult(Boolean(policy.deterministicRequests))
  return null
}
