import { prisma } from './prisma'

export const POINTS_FEEDBACK = 0.25
export const POINTS_PER_5_MIN_ACTIVE = 0.5

/** Award points when admin marks feedback as Considered (once per submission). */
export async function awardFeedbackConsideredPoints(
  userId: string,
  feedbackId: string,
): Promise<{ awarded: number; total: number }> {
  const feedback = await prisma.userFeedback.findUnique({
    where: { id: feedbackId },
    select: { userId: true, pointsAwarded: true },
  })
  if (!feedback || feedback.userId !== userId || feedback.pointsAwarded) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { rewardPoints: true },
    })
    return { awarded: 0, total: user?.rewardPoints ?? 0 }
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { rewardPoints: { increment: POINTS_FEEDBACK } },
    select: { rewardPoints: true },
  })
  await prisma.userFeedback.update({
    where: { id: feedbackId },
    data: { pointsAwarded: true },
  })
  return { awarded: POINTS_FEEDBACK, total: user.rewardPoints }
}

/**
 * Active session time = sum of user→assistant and assistant→user gaps under 120s.
 * Excludes idle gaps (pause, long silence).
 */
export function computeActiveSessionSeconds(
  messages: Array<{ role: string; timestamp: string | Date }>,
): number {
  if (messages.length < 2) return 0
  let active = 0
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1]
    const curr = messages[i]
    if (prev.role === curr.role) continue
    const a = new Date(prev.timestamp).getTime()
    const b = new Date(curr.timestamp).getTime()
    const gap = (b - a) / 1000
    if (gap > 0 && gap <= 120) active += gap
  }
  return active
}

export function pointsForActiveSeconds(activeSec: number): number {
  if (activeSec <= 0) return 0
  const blocks = Math.floor(activeSec / 300) // 5 minutes
  return blocks * POINTS_PER_5_MIN_ACTIVE
}

export async function awardSessionActivePoints(
  userId: string,
  sessionId: string,
): Promise<{ awarded: number; total: number }> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, sessionPointsAwarded: true },
    })
    if (!session || session.userId !== userId) {
      return { awarded: 0, total: 0 }
    }

    const currentUser = await tx.user.findUnique({
      where: { id: userId },
      select: { rewardPoints: true },
    })
    const currentTotal = currentUser?.rewardPoints ?? 0

    if (session.sessionPointsAwarded) {
      return { awarded: 0, total: currentTotal }
    }

    const transcript = await tx.sessionTranscript.findUnique({
      where: { sessionId },
    })
    if (!transcript?.conversationData) {
      return { awarded: 0, total: currentTotal }
    }

    const data = transcript.conversationData as { messages?: Array<{ role: string; timestamp: string }> }
    const messages = data.messages ?? []
    const activeSec = computeActiveSessionSeconds(messages)
    const awarded = pointsForActiveSeconds(activeSec)

    const claim = await tx.session.updateMany({
      where: { id: sessionId, sessionPointsAwarded: false },
      data: { sessionPointsAwarded: true },
    })
    if (claim.count === 0) {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { rewardPoints: true },
      })
      return { awarded: 0, total: user?.rewardPoints ?? currentTotal }
    }

    if (awarded <= 0) {
      return { awarded: 0, total: currentTotal }
    }

    const user = await tx.user.update({
      where: { id: userId },
      data: { rewardPoints: { increment: awarded } },
      select: { rewardPoints: true },
    })
    return { awarded, total: user.rewardPoints }
  })
}
