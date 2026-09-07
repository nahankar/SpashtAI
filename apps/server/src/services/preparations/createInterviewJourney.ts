import {
  PreparationStageType,
  PreparationType,
  type Prisma,
} from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { buildDefaultStages } from '../../lib/prepareStages'

export type CreateInterviewJourneyInput = {
  companyName: string
  roleTitle: string
  interviewDate: Date | null
  currentStageType?: PreparationStageType | null
  jobDescriptionText: string | null
  resumeText: string | null
  resumeLabel: string | null
  interviewerName: string | null
  interviewerRole: string | null
  interviewerProfileText: string | null
}

export const preparationInclude = {
  interview: true,
  stages: { orderBy: { sequence: 'asc' as const } },
} satisfies Prisma.PreparationInclude

export const preparationDetailInclude = {
  interview: true,
  stages: {
    orderBy: { sequence: 'asc' as const },
    include: { reflection: true },
  },
  questions: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.PreparationInclude

export async function createInterviewJourney(
  userId: string,
  input: CreateInterviewJourneyInput,
) {
  const stages = buildDefaultStages(
    input.currentStageType ?? undefined,
    input.interviewDate ?? undefined,
  )
  const hasInterviewer = Boolean(
    input.interviewerName || input.interviewerRole || input.interviewerProfileText,
  )
  const selectedIndex = input.currentStageType
    ? stages.findIndex((stage) => stage.type === input.currentStageType)
    : input.interviewDate || hasInterviewer
      ? 0
      : -1

  return prisma.preparation.create({
    data: {
      userId,
      type: PreparationType.INTERVIEW,
      title: `${input.companyName} — ${input.roleTitle}`,
      interview: {
        create: {
          companyName: input.companyName,
          roleTitle: input.roleTitle,
          jobDescriptionText: input.jobDescriptionText,
          interviewDate: input.interviewDate,
          resumeText: input.resumeText,
          resumeLabel: input.resumeLabel,
        },
      },
      stages: {
        create: stages.map((stage, index) => ({
          ...stage,
          interviewerName: index === selectedIndex ? input.interviewerName : null,
          interviewerRole: index === selectedIndex ? input.interviewerRole : null,
          interviewerProfileText:
            index === selectedIndex ? input.interviewerProfileText : null,
        })),
      },
    },
    include: preparationInclude,
  })
}
