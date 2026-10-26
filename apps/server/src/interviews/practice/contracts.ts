import { z } from 'zod'

export const PRACTICE_NAMESPACE = 'automation-pilot'
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
  // Minutes, or null for no time limit. Omitted means the learner's plan default; the plan decides what is allowed.
  durationMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.null()]).optional(),
  // The per-practice checkbox. Optional once the account holds the current recording acknowledgment.
  recordingConsent: z.literal(true).optional(),
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
/**
 * One-time, account-level Interviews recording and AI-processing acknowledgment (replaces the per-practice
 * checkbox once accepted). The version, scope and a hash of the exact text are stored with each acceptance;
 * changing the text requires a new version, and nothing is inferred for accounts that never accepted it.
 * Learner-facing text names no service provider (docs/prepare/POLICY-INTERVIEWS-RECORDING.md).
 */
const ACKNOWLEDGMENT_SCOPE = ['interview-audio-recording', 'speech-transcription', 'ai-technical-evaluation', 'storage-and-deletion'] as const
/** Every acknowledgment version ever shown, with its exact text, so historical acceptances stay verifiable. Never edit. */
export const RECORDING_ACKNOWLEDGMENT_VERSIONS = {
  'interview-recording-ai-1': { scope: ACKNOWLEDGMENT_SCOPE,
    text: 'Interview practice records your microphone audio during each practice and transcribes it automatically (Amazon Transcribe). '
      + 'Your saved answers may be evaluated by AI (Amazon Bedrock) to give technical feedback; this feedback is experimental and can be wrong. '
      + 'Recordings, transcripts and feedback are stored with your account so you can review them, and an unfinished practice is completed automatically after 24 hours without activity. '
      + 'You can delete any practice, with its recording, transcript and feedback, from Interview history at any time. '
      + 'Do not share confidential company or personal information in your answers.' },
  'interview-recording-ai-2': { scope: ACKNOWLEDGMENT_SCOPE,
    text: 'Interview practice records your microphone audio during each practice and converts it to text with automatic speech recognition. '
      + 'Your saved answers may be evaluated by AI to give technical feedback; AI technical feedback is experimental and can be wrong. '
      + 'Speech recognition and AI technical feedback run on third-party cloud services that process this content on our behalf. '
      + 'Recordings, transcripts and feedback are stored with your account so you can review them, and an unfinished practice is completed automatically after 24 hours without activity. '
      + 'You can delete any practice, with its recording, transcript and feedback, from Interview history at any time. '
      + 'Do not share confidential company or personal information in your answers.' },
} as const
export const RECORDING_ACKNOWLEDGMENT = { version: 'interview-recording-ai-2', ...RECORDING_ACKNOWLEDGMENT_VERSIONS['interview-recording-ai-2'] } as const
/**
 * Practice-level consent versions a run may carry: the legacy per-practice checkbox, or any acknowledgment version
 * (practices started under an earlier acknowledgment stay valid; new practices need the current one).
 */
export const RECORDING_CONSENT_VERSIONS: readonly string[] = [VOICE_CONSENT_VERSION, ...Object.keys(RECORDING_ACKNOWLEDGMENT_VERSIONS)]
export const acknowledgmentSchema = z.object({ version: z.string().min(1).max(80) }).strict()
// Pinned on new runs with Interview conversation access; NULL keeps today's manual mode. Frozen once
// pinned: changing timings needs a new version so earlier runs keep their behaviour.
export const CONVERSATION_POLICY = { version: 'conversation-1', handoffSilenceMs: 5000, settleMs: 1200, maxBarrierMs: 8000 } as const
export const conversationPolicySchema = z.object({ version: z.literal('conversation-1'), handoffSilenceMs: z.number().int().positive(),
  settleMs: z.number().int().positive(), maxBarrierMs: z.number().int().positive() }).strict()
// Advancing names the attempt it follows, so a stale tab or a late handler cannot create an extra question.
export const nextSchema = z.object({ afterAttemptId: id.optional() }).strict()
export const agentFinishSchema = z.object({ receiptId: z.string().uuid(), skip: z.boolean().default(false) }).strict()
export const agentNextSchema = z.object({ afterAttemptId: id }).strict()
