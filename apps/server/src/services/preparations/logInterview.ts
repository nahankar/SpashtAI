import {
  InterviewQuestionSource,
  PreparationStageStatus,
  type Prisma,
} from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { lockOwnedPreparation } from '../../lib/prepareAccess'
import {
  MAX_QUESTIONS_PER_JOURNEY,
  parseInterviewQuestions,
  uniqueNewQuestions,
} from '../../lib/parseInterviewQuestions'
import { preparationDetailInclude } from './createInterviewJourney'

export class LogInterviewError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'QUESTION_LIMIT',
  ) {
    super(message)
  }
}

export type LogInterviewInput = {
  stageId: string
  rating?: 'VERY_POOR' | 'POOR' | 'FAIR' | 'GOOD' | 'EXCELLENT' | null
  outcome?: 'PASSED' | 'REJECTED' | 'PENDING' | 'UNKNOWN' | null
  wentWell?: string | null
  difficulties?: string | null
  surprisedBy?: string | null
  feedbackReceived?: string | null
  nextRoundHints?: string | null
  questionsText?: string | null
  nextStageScheduledAt?: Date | null
}

export async function logInterview(
  userId: string,
  preparationId: string,
  input: LogInterviewInput,
) {
  const questions = parseInterviewQuestions(input.questionsText)

  return prisma.$transaction(async (tx) => {
    if (!(await lockOwnedPreparation(tx, userId, preparationId))) {
      throw new LogInterviewError('Not found', 'NOT_FOUND')
    }

    const stage = await tx.preparationStage.findFirst({
      where: { id: input.stageId, preparationId },
    })
    if (!stage) {
      throw new LogInterviewError('Not found', 'NOT_FOUND')
    }

    const existingQuestions = await tx.interviewQuestion.findMany({
      where: { preparationId, stageId: stage.id },
      select: { questionText: true },
    })
    const freshQuestions = uniqueNewQuestions(
      questions,
      existingQuestions.map((question) => question.questionText),
    )
    const existingCount = await tx.interviewQuestion.count({
      where: { preparationId },
    })
    if (existingCount + freshQuestions.length > MAX_QUESTIONS_PER_JOURNEY) {
      throw new LogInterviewError(
        `A journey can remember at most ${MAX_QUESTIONS_PER_JOURNEY} questions`,
        'QUESTION_LIMIT',
      )
    }

    const completedAt =
      stage.status === PreparationStageStatus.COMPLETED && stage.completedAt
        ? stage.completedAt
        : new Date()

    await tx.preparationStage.update({
      where: { id: stage.id },
      data: {
        status: PreparationStageStatus.COMPLETED,
        completedAt,
      },
    })

    const reflectionPatch = {
      ...(input.rating !== undefined ? { rating: input.rating } : {}),
      ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
      ...(input.wentWell !== undefined ? { wentWell: input.wentWell } : {}),
      ...(input.difficulties !== undefined ? { difficulties: input.difficulties } : {}),
      ...(input.surprisedBy !== undefined ? { surprisedBy: input.surprisedBy } : {}),
      ...(input.feedbackReceived !== undefined
        ? { feedbackReceived: input.feedbackReceived }
        : {}),
      ...(input.nextRoundHints !== undefined ? { nextRoundHints: input.nextRoundHints } : {}),
    }
    if (Object.keys(reflectionPatch).length > 0) {
      await tx.stageReflection.upsert({
        where: { stageId: stage.id },
        create: {
          preparationId,
          stageId: stage.id,
          rating: input.rating ?? null,
          outcome: input.outcome ?? null,
          wentWell: input.wentWell ?? null,
          difficulties: input.difficulties ?? null,
          surprisedBy: input.surprisedBy ?? null,
          feedbackReceived: input.feedbackReceived ?? null,
          nextRoundHints: input.nextRoundHints ?? null,
        },
        update: reflectionPatch,
      })
    }

    if (freshQuestions.length > 0) {
      await tx.interviewQuestion.createMany({
        data: freshQuestions.map((questionText) => ({
          preparationId,
          stageId: stage.id,
          questionText,
          source: InterviewQuestionSource.ACTUAL_INTERVIEW,
          askedAt: completedAt,
        })),
      })
    }

    if (input.nextStageScheduledAt) {
      const stages = await tx.preparationStage.findMany({
        where: { preparationId },
        orderBy: { sequence: 'asc' },
      })
      const nextIncomplete = stages.find(
        (candidate) =>
          candidate.sequence > stage.sequence &&
          (candidate.status === PreparationStageStatus.UPCOMING ||
            candidate.status === PreparationStageStatus.SCHEDULED),
      )
      if (nextIncomplete) {
        await tx.preparationStage.update({
          where: { id: nextIncomplete.id },
          data: {
            status: PreparationStageStatus.SCHEDULED,
            scheduledAt: input.nextStageScheduledAt,
          },
        })
        await tx.interviewPreparation.update({
          where: { preparationId },
          data: { interviewDate: input.nextStageScheduledAt },
        })
      }
    }

    return tx.preparation.findFirst({
      where: { id: preparationId, userId },
      include: preparationDetailInclude,
    })
  })
}

export type PreparationDetail = Prisma.PreparationGetPayload<{
  include: typeof preparationDetailInclude
}>
