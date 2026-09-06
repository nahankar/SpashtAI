import {
  PreparationStageStatus,
  PreparationStageType,
  PreparationStatus,
} from '@prisma/client'
import { z } from 'zod'
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

export const createStageSchema = z
  .object({
    type: z.nativeEnum(PreparationStageType),
    name: shortText('Stage name', PREPARE_TEXT_LIMITS.stageName),
    status: z.nativeEnum(PreparationStageStatus).optional(),
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
