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
  if (!profile.success) throw new BankError(409, 'This pilot requires the Transcribe and Polly voice pipeline. Ask your administrator to check Voice Backend settings.')
  return profile.data
}
