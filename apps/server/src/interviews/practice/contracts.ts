import { z } from 'zod'

export const PRACTICE_NAMESPACE = 'automation-pilot'
export const MAX_QUESTIONS = 8
export const MAX_ANSWER_LENGTH = 8000
const id = z.string().min(1).max(160)
export const startSchema = z.object({
  sessionId: id.regex(/^[a-zA-Z0-9_-]+$/), track: z.string().trim().min(1).max(120),
  experienceBand: z.enum(['0-2', '2-5', '5-8', '8+']),
  startingDifficulty: z.enum(['Simple', 'Medium', 'Complex', 'Very Complex']),
  durationMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]).default(10),
}).strict()
export const askedSchema = z.object({ segmentId: id, questionText: z.string().min(1).max(8000) }).strict()
export const chunkSchema = z.object({
  segmentId: id, sourceTurnId: id, localTurnIndex: z.number().int().nonnegative(),
  role: z.literal('user'), text: z.string().min(1).max(MAX_ANSWER_LENGTH).refine(v => Boolean(v.trim()), 'A committed speech turn must contain text'),
}).strict()
export const assistanceSchema = z.object({ assistance: z.enum(['HINT', 'EXAMPLE']) }).strict()
