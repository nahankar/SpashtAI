import { z } from 'zod'

export const PRACTICE_NAMESPACE = 'automation-pilot'
export const MAX_QUESTIONS = 8
export const MAX_ANSWER_LENGTH = 8000
const id = z.string().min(1).max(160)
// A setup picks one or more values per dimension. Runs persist them '|'-joined
// (a single value is stored exactly as before), de-duplicated and sorted.
const selection = <T extends z.ZodTypeAny>(item: T, maximum = 20) =>
  z.union([item.transform(v => [v as string]), z.array(item).min(1).max(maximum)]).transform(v => [...new Set(v as string[])].sort())
export const SELECTION_SEPARATOR = '|'
export const joinSelection = (values: string[]) => values.join(SELECTION_SEPARATOR)
export const splitSelection = (stored: string) => stored.split(SELECTION_SEPARATOR).filter(Boolean)
export const startSchema = z.object({
  sessionId: id.regex(/^[a-zA-Z0-9_-]+$/), track: selection(z.string().trim().min(1).max(160).regex(/^[^|]+$/)),
  experienceBand: selection(z.enum(['0-2', '2-5', '5-8', '8+']), 4),
  startingDifficulty: selection(z.enum(['Simple', 'Medium', 'Complex', 'Very Complex']), 4),
  durationMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]).default(10),
  recordingConsent: z.literal(true),
}).strict()
export const askedSchema = z.object({ segmentId: id, questionText: z.string().min(1).max(8000) }).strict()
export const chunkSchema = z.object({
  segmentId: id, sourceTurnId: id, localTurnIndex: z.number().int().nonnegative(),
  role: z.literal('user'), text: z.string().min(1).max(MAX_ANSWER_LENGTH).refine(v => Boolean(v.trim()), 'A committed speech turn must contain text'),
}).strict()
export const assistanceSchema = z.object({ assistance: z.enum(['HINT', 'EXAMPLE']) }).strict()
export const receiptSchema = z.object({
  id: z.string().uuid(), segmentId: id, action: z.enum(['FINISH', 'SKIP', 'PAUSE', 'LEAVE']),
  lastTurnIndex: z.number().int().min(-1),
}).strict()
export const VOICE_CONSENT_VERSION = 'interview-recording-1'
