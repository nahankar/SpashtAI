import { prisma } from './prisma'
import { preparationDetailInclude, preparationInclude } from '../services/preparations/createInterviewJourney'
import type { Prisma } from '@prisma/client'

export async function getOwnedPreparation(userId: string, id: string) {
  return prisma.preparation.findFirst({
    where: { id, userId },
    include: preparationInclude,
  })
}

export async function getOwnedPreparationDetail(userId: string, id: string) {
  return prisma.preparation.findFirst({
    where: { id, userId },
    include: preparationDetailInclude,
  })
}

export async function getOwnedStage(
  userId: string,
  preparationId: string,
  stageId: string,
) {
  return prisma.preparationStage.findFirst({
    where: {
      id: stageId,
      preparationId,
      preparation: { userId },
    },
  })
}

export async function ownsPreparation(userId: string, id: string): Promise<boolean> {
  const count = await prisma.preparation.count({ where: { id, userId } })
  return count === 1
}

/** Locks the journey row so concurrent stage inserts cannot share a sequence. */
export async function lockOwnedPreparation(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Preparation"
    WHERE id = ${id} AND "userId" = ${userId}
    FOR UPDATE
  `
  return rows.length === 1
}
