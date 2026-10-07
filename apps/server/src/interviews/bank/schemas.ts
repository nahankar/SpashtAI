import { z } from 'zod'

const optionalText = (max: number) => z.string().trim().max(max).nullable().default(null)
const lines = z.array(z.string().trim().min(1).max(2000)).max(30)
export const publicCriterionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/), label: z.string().trim().max(200),
}).strict()
export const rubricSchema = z.object({
  criteria: z.array(z.object({
    id: publicCriterionSchema.shape.id,
    essential: z.boolean(), points: lines, alternatives: lines, misconceptions: lines,
    // Ordered anchors: not demonstrated, partial, meets, strong.
    anchors: z.array(z.string().trim().max(2000)).length(4),
  }).strict()).max(20),
  notes: z.string().trim().max(8000).default(''),
}).strict()
export const draftSchema = z.object({
  questionText: z.string().trim().min(2).max(12000),
  track: optionalText(160), category: optionalText(160), topic: optionalText(300),
  difficulty: z.enum(['Simple', 'Medium', 'Complex', 'Very Complex']).nullable().default(null),
  experienceBand: z.enum(['0-2', '2-5', '5-8', '8+']).nullable().default(null),
  frequency: z.enum(['Foundational', 'Core', 'Occasional', 'Niche']).nullable().default(null),
  questionType: optionalText(160), roleArchetype: optionalText(160),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  trendNote: optionalText(4000),
  explanation: z.string().trim().max(16000).default(''),
  exampleAnswer: z.string().trim().max(16000).default(''),
  publicCriteria: z.array(publicCriterionSchema).max(20).default([]),
  evaluationMode: z.enum(['TECHNICAL', 'SCENARIO', 'BEHAVIORAL']).nullable().default(null),
  verbalSuitable: z.boolean().default(false), expectedDepth: z.string().trim().max(2000).default(''),
  referenceSources: z.array(z.string().trim().min(1).max(2000)).max(30).default([]),
  rightsBasis: z.enum(['UNRECORDED', 'OWNED', 'LICENSED', 'REWRITTEN']).default('UNRECORDED'),
  rightsNotes: z.string().trim().max(8000).default(''),
  learnerContentRewritten: z.boolean().default(false), rubricIndependentlyAuthored: z.boolean().default(false),
  rubric: rubricSchema.nullable().default(null),
}).strict()
export type BankDraft = z.infer<typeof draftSchema>
export const identitySchema = z.object({
  namespace: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  externalQid: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/),
}).strict()
export const editSchema = z.object({ revision: z.number().int().positive(), draft: draftSchema }).strict()
export const revisionSchema = z.object({ revision: z.number().int().positive() }).strict()

export function publicationBlockers(draft: BankDraft, source?: { sourceQuestionText?: string | null; sourceAnswer?: string | null }): string[] {
  const problems: string[] = []
  if (!draft.track) problems.push('Track needs confirmation')
  if (!draft.category || !draft.topic) problems.push('Category and topic are required')
  if (!draft.difficulty || !draft.experienceBand) problems.push('Difficulty and experience band are required')
  if (!draft.evaluationMode) problems.push('Choose an evaluation mode')
  if (!draft.verbalSuitable) problems.push('Confirm suitability for a spoken answer')
  if (!draft.expectedDepth) problems.push('Expected answer depth is required')
  if (!draft.exampleAnswer) problems.push('An approved learner example answer is required')
  if (!draft.explanation) problems.push('An approved learner explanation is required')
  if (!draft.referenceSources.length) problems.push('Record reference sources and review their accuracy')
  if (draft.rightsBasis === 'UNRECORDED' || draft.rightsNotes.length < 10) problems.push('Record content rights or independent rewriting provenance')
  if (draft.rightsBasis === 'REWRITTEN') {
    if (!draft.learnerContentRewritten || !draft.rubricIndependentlyAuthored) problems.push('Confirm independent learner rewriting and rubric authorship')
    const normalize = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
    if (source?.sourceQuestionText && normalize(draft.questionText) === normalize(source.sourceQuestionText)) problems.push('Rewrite the source question before publishing as rewritten content')
    if (source?.sourceAnswer && [draft.exampleAnswer, draft.explanation].some(text => normalize(text) === normalize(source.sourceAnswer!))) problems.push('Learner content still copies the source answer')
  }
  const publicIds = draft.publicCriteria.map(c => c.id)
  const privateIds = draft.rubric?.criteria.map(c => c.id) ?? []
  if (!draft.rubric || !publicIds.length) problems.push('A private rubric and public criteria are required')
  if (draft.publicCriteria.some(c => !c.label) || draft.rubric?.criteria.some(c => c.anchors.some(a => !a))) problems.push('Complete learner criterion labels and all four private scoring anchors')
  if (new Set(publicIds).size !== publicIds.length || new Set(privateIds).size !== privateIds.length
    || publicIds.length !== privateIds.length || publicIds.some(id => !privateIds.includes(id))) problems.push('Each public criterion must have exactly one matching private rubric criterion')
  if (draft.rubric?.criteria.some(c => c.essential && !c.points.length)) problems.push('Essential criteria need required answer points')
  return problems
}
