import { isPrivilegedRole } from '../../lib/userExportFlags'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { BankError } from '../bank/csv'

export const voiceProfileSchema = z.object({
  backend: z.literal('pipeline-bedrock'), sttProvider: z.literal('transcribe'), ttsProvider: z.literal('polly'),
  voiceName: z.string().nullable(), pipelineStt: z.string().nullable(), pipelineLlm: z.string().nullable(),
  pipelineTts: z.string().nullable(), sttBaseUrl: z.string().nullable(), llmBaseUrl: z.string().nullable(), ttsBaseUrl: z.string().nullable(),
  hushEnabled: z.boolean(),
}).strict()
export async function practiceExecutionAccess(ownerId: string, tx: Prisma.TransactionClient = prisma) {
  for (const feature of ['interviews', 'interview_voice']) {
    await tx.$queryRaw`SELECT feature FROM "PlatformFeatureFlag" WHERE feature=${feature} FOR SHARE`
    const flag = await tx.platformFeatureFlag.findUnique({ where: { feature } })
    await tx.$queryRaw`SELECT id FROM "UserFeatureGrant" WHERE "userId"=${ownerId} AND feature=${feature} FOR SHARE`
    const grant = await tx.userFeatureGrant.findUnique({ where: { userId_feature: { userId: ownerId, feature } } })
    if (!flag || flag.hidden || flag.disabled || (flag.audience === 'SELECTED_USERS' && !grant)) {
      throw new BankError(403, 'Interview voice practice is not available')
    }
  }
}
/** Interview conversation (automatic progression) on top of execution access; false rather than an error. */
/**
 * Practice time the learner's plan allows, verified server-side. Ultra (or an Admin role, which has every plan
 * feature) offers no time limit and defaults to it; Pro adds 30 minutes and defaults to it; others keep 5-15
 * minutes with a 10-minute default. Ultra wins when both switches are on. null means no time limit; the
 * question cap is separate and unchanged.
 */
export type PracticeDurations = { plan: 'ultra' | 'pro' | 'standard'; allowed: (number | null)[]; default: number | null }
export function practiceDurations(user: { role?: string | null; enablePro?: boolean | null; enableUltra?: boolean | null }): PracticeDurations {
  if (isPrivilegedRole(user.role ?? undefined) || user.enableUltra) return { plan: 'ultra', allowed: [5, 10, 15, 30, null], default: null }
  if (user.enablePro) return { plan: 'pro', allowed: [5, 10, 15, 30], default: 30 }
  return { plan: 'standard', allowed: [5, 10, 15], default: 10 }
}
export async function ownerPracticeDurations(ownerId: string, tx: Prisma.TransactionClient = prisma) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: ownerId }, select: { role: true, enablePro: true, enableUltra: true } })
  return practiceDurations(user)
}
export async function conversationAccess(ownerId: string, tx: Prisma.TransactionClient = prisma) {
  try { await practiceExecutionAccess(ownerId, tx) } catch (error) { if (error instanceof BankError) return false; throw error }
  await tx.$queryRaw`SELECT feature FROM "PlatformFeatureFlag" WHERE feature='interview_conversation' FOR SHARE`
  const flag = await tx.platformFeatureFlag.findUnique({ where: { feature: 'interview_conversation' } })
  if (!flag || flag.hidden || flag.disabled) return false
  if (flag.audience !== 'SELECTED_USERS') return true
  await tx.$queryRaw`SELECT id FROM "UserFeatureGrant" WHERE "userId"=${ownerId} AND feature='interview_conversation' FOR SHARE`
  return Boolean(await tx.userFeatureGrant.findUnique({ where: { userId_feature: { userId: ownerId, feature: 'interview_conversation' } } }))
}
export async function currentInterviewVoiceProfile(tx: Prisma.TransactionClient = prisma) {
  const voice = await tx.voiceConfig.findFirst({ where: { isActive: true } })
  if (!voice) throw new BankError(409, 'The interview voice pipeline is not configured')
  await tx.$queryRaw`SELECT id FROM "VoiceConfig" WHERE id=${voice.id} FOR SHARE`
  const current = await tx.voiceConfig.findFirst({ where: { id: voice.id, isActive: true } })
  const profile = voiceProfileSchema.safeParse(current && Object.fromEntries(Object.keys(voiceProfileSchema.shape).map(k => [k, current[k as keyof typeof current]])))
  if (!profile.success) throw new BankError(409, 'Interview practice is not available right now because its speech recognition and voice settings are not ready. Ask your administrator to check the voice settings.')
  return profile.data
}
