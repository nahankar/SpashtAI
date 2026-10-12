import { z } from 'zod'
const text = (fallback: string, max = 160) => z.string().trim().max(max).default(fallback)
export const draftSchema = z.object({
  questionText: z.string().trim().min(2).max(12000),
  track: text('General'), category: text('General'), topic: text('General', 300),
  difficulty: z.enum(['Simple', 'Medium', 'Complex', 'Very Complex']).default('Medium'),
  experienceBand: z.enum(['0-2', '2-5', '5-8', '8+']).default('2-5'),
  frequency: z.enum(['Foundational', 'Core', 'Occasional', 'Niche']).default('Core'),
  questionType: text('Technical'), roleArchetype: text('IC'),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]), trendNote: text('', 4000),
  explanation: text('', 16000), exampleAnswer: text('', 16000), goodAnswerPoints: text('', 16000), followUpGuidance: text('', 8000),
  verbalSuitable: z.boolean().default(true), expectedDepth: text('Explain your reasoning and give a practical example.', 2000),
  referenceSources: z.array(z.string().trim().min(1).max(2000)).max(30).default([]),
  reviewNotes: text('', 8000), generationNotes: text('', 8000),
}).strict()
export type BankDraft = z.infer<typeof draftSchema>
export const identitySchema = z.object({
  namespace: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  externalQid: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/),
}).strict()
export const revisionSchema = z.object({ revision: z.number().int().positive() }).strict()
export const editSchema = z.object({ revision: revisionSchema.shape.revision, draft: draftSchema }).strict()
export const bankActionSchema = z.enum(['approve', 'activate', 'deactivate', 'approve_activate', 'delete'])
export const bulkSchema = z.object({
  action: bankActionSchema,
  questions: z.array(z.object({ id: z.string().min(1).max(100), revision: revisionSchema.shape.revision }).strict()).min(1).max(2000),
}).strict().refine(v => new Set(v.questions.map(q => q.id)).size === v.questions.length, 'Select each question once')
export const provenanceSchema = z.object({
  confirmed: z.literal(true), note: z.string().trim().min(20).max(2000),
  questions: z.array(z.object({ id: z.string().min(1).max(100), revision: revisionSchema.shape.revision }).strict()).min(1).max(2000),
}).strict().refine(v => new Set(v.questions.map(q => q.id)).size === v.questions.length, 'Select each question once')
export function learnerActivationBlockers(draft: BankDraft, confirmedAt: Date | null): string[] {
  return [...activationBlockers(draft), ...(!confirmedAt ? ['Confirm learning content provenance'] : [])]
}
export const learnerEligibleWhere = { approved: true, active: true, verbalSuitable: true, provenanceConfirmedAt: { not: null } } as const
export function activationBlockers(draft: BankDraft): string[] {
  const issues: string[] = []
  if (draft.track === 'General' || !draft.track) issues.push('Confirm the track')
  if (!draft.verbalSuitable) issues.push('Question is not suitable for spoken practice')
  if (!draft.goodAnswerPoints && !draft.exampleAnswer) issues.push('Add good answer points or an example answer')
  return issues
}
