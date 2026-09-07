import {
  InterviewOutcome,
  InterviewQuestionSource,
  InterviewRating,
  PreparationStageStatus,
  PreparationStageType,
  PreparationStatus,
} from '@prisma/client'
import { z } from 'zod'
import { MAX_QUESTION_TEXT, MAX_QUESTIONS_PER_LOG } from './parseInterviewQuestions'
import { MAX_PREPARATION_STAGES } from './prepareStages'

/** Shared with the web client so long pastes are capped before they are submitted. */
export const PREPARE_TEXT_LIMITS = {
  companyName: 160,
  roleTitle: 200,
  resumeLabel: 160,
  stageName: 160,
  interviewerName: 160,
  interviewerRole: 200,
  jobDescriptionText: 30_000,
  resumeText: 30_000,
  interviewerProfileText: 20_000,
  reflectionText: 8_000,
  questionsText: 20_000,
  questionText: MAX_QUESTION_TEXT,
  questionMeta: 160,
  questionNotes: 4_000,
} as const

const shortText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max)

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value === undefined ? undefined : value || null))

const optionalDate = z
  .string()
  .datetime({ offset: true })
  .optional()
  .nullable()
  .transform((value) =>
    value === undefined ? undefined : value ? new Date(value) : null,
  )

export const createPreparationSchema = z
  .object({
    companyName: shortText('Company', PREPARE_TEXT_LIMITS.companyName),
    roleTitle: shortText('Role', PREPARE_TEXT_LIMITS.roleTitle),
    interviewDate: optionalDate,
    currentStageType: z.nativeEnum(PreparationStageType).optional().nullable(),
    jobDescriptionText: optionalText(PREPARE_TEXT_LIMITS.jobDescriptionText),
    resumeText: optionalText(PREPARE_TEXT_LIMITS.resumeText),
    resumeLabel: optionalText(PREPARE_TEXT_LIMITS.resumeLabel),
    interviewerName: optionalText(PREPARE_TEXT_LIMITS.interviewerName),
    interviewerRole: optionalText(PREPARE_TEXT_LIMITS.interviewerRole),
    interviewerProfileText: optionalText(PREPARE_TEXT_LIMITS.interviewerProfileText),
  })
  .strict()

export const updatePreparationSchema = z
  .object({
    status: z.nativeEnum(PreparationStatus).optional(),
    companyName: shortText('Company', PREPARE_TEXT_LIMITS.companyName).optional(),
    roleTitle: shortText('Role', PREPARE_TEXT_LIMITS.roleTitle).optional(),
    interviewDate: optionalDate,
    jobDescriptionText: optionalText(PREPARE_TEXT_LIMITS.jobDescriptionText),
    resumeText: optionalText(PREPARE_TEXT_LIMITS.resumeText),
    resumeLabel: optionalText(PREPARE_TEXT_LIMITS.resumeLabel),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No fields to update')

const pipelineStageStatus = z
  .nativeEnum(PreparationStageStatus)
  .refine(
    (status) => status !== PreparationStageStatus.COMPLETED,
    'Log the interview to mark this round completed',
  )

export const createStageSchema = z
  .object({
    type: z.nativeEnum(PreparationStageType),
    name: shortText('Stage name', PREPARE_TEXT_LIMITS.stageName),
    status: pipelineStageStatus.optional(),
    scheduledAt: optionalDate,
    interviewerName: optionalText(PREPARE_TEXT_LIMITS.interviewerName),
    interviewerRole: optionalText(PREPARE_TEXT_LIMITS.interviewerRole),
    interviewerProfileText: optionalText(PREPARE_TEXT_LIMITS.interviewerProfileText),
  })
  .strict()

export const updateStageSchema = createStageSchema
  .partial()
  .extend({
    completedAt: optionalDate,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No fields to update')

export const reorderStagesSchema = z
  .object({
    stageIds: z.array(z.string().cuid()).min(1).max(MAX_PREPARATION_STAGES),
  })
  .strict()

const reflectionFields = {
  rating: z.nativeEnum(InterviewRating).optional().nullable(),
  outcome: z.nativeEnum(InterviewOutcome).optional().nullable(),
  wentWell: optionalText(PREPARE_TEXT_LIMITS.reflectionText),
  difficulties: optionalText(PREPARE_TEXT_LIMITS.reflectionText),
  surprisedBy: optionalText(PREPARE_TEXT_LIMITS.reflectionText),
  feedbackReceived: optionalText(PREPARE_TEXT_LIMITS.reflectionText),
  nextRoundHints: optionalText(PREPARE_TEXT_LIMITS.reflectionText),
}

export const upsertReflectionSchema = z.object(reflectionFields).strict().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  'No fields to update',
)

export const createQuestionSchema = z
  .object({
    questionText: shortText('Question', PREPARE_TEXT_LIMITS.questionText),
    source: z
      .nativeEnum(InterviewQuestionSource)
      .refine(
        (source) =>
          source === InterviewQuestionSource.USER_ENTERED ||
          source === InterviewQuestionSource.ACTUAL_INTERVIEW,
        'Practice and suggested questions are not available yet',
      )
      .optional(),
    stageId: z.string().cuid().optional().nullable(),
    category: optionalText(PREPARE_TEXT_LIMITS.questionMeta),
    topic: optionalText(PREPARE_TEXT_LIMITS.questionMeta),
    difficulty: optionalText(PREPARE_TEXT_LIMITS.questionMeta),
    notes: optionalText(PREPARE_TEXT_LIMITS.questionNotes),
    askedAt: optionalDate,
  })
  .strict()

export const updateQuestionSchema = createQuestionSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No fields to update')

export const logInterviewSchema = z
  .object({
    stageId: z.string().cuid(),
    ...reflectionFields,
    questionsText: optionalText(PREPARE_TEXT_LIMITS.questionsText),
    nextStageScheduledAt: optionalDate,
  })
  .strict()
  .refine((value) => {
    const hasQuestions = Boolean(value.questionsText?.trim())
    return (
      hasQuestions ||
      value.rating != null ||
      value.outcome != null ||
      Boolean(value.wentWell) ||
      Boolean(value.difficulties) ||
      Boolean(value.surprisedBy) ||
      Boolean(value.feedbackReceived) ||
      Boolean(value.nextRoundHints)
    )
  }, 'Add what they asked, how it went, or a short reflection')
  .refine(
    (value) =>
      !value.questionsText ||
      value.questionsText.split(/\r?\n/).filter((line) => line.trim()).length <=
        MAX_QUESTIONS_PER_LOG,
    `Log at most ${MAX_QUESTIONS_PER_LOG} questions at a time`,
  )
