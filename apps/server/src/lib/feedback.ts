import { prisma } from './prisma'

export const FEEDBACK_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'CONSIDERED', 'IMPLEMENTED', 'PARKED'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export const FEEDBACK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number]

export async function generateFeedbackNumber(): Promise<string> {
  const count = await prisma.userFeedback.count()
  return `FB-${String(count + 1).padStart(5, '0')}`
}

export function isFeedbackEditable(status: string): boolean {
  return status === 'OPEN'
}
