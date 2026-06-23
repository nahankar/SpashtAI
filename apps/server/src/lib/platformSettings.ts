import { prisma } from './prisma'

const DEFAULT_SIGNUPS_PAUSED_MESSAGE =
  'New signups are temporarily paused. Please check back soon or contact support if you need access.'

export async function ensurePlatformSettings() {
  const existing = await prisma.platformSettings.findUnique({ where: { id: 'default' } })
  if (!existing) {
    await prisma.platformSettings.create({
      data: {
        id: 'default',
        signupsPaused: false,
        signupsPausedMessage: DEFAULT_SIGNUPS_PAUSED_MESSAGE,
      },
    })
  }
}

export async function getPlatformSettings() {
  await ensurePlatformSettings()
  return prisma.platformSettings.findUniqueOrThrow({ where: { id: 'default' } })
}

export async function areSignupsPaused(): Promise<boolean> {
  const settings = await getPlatformSettings()
  return settings.signupsPaused
}

export async function getSignupsPausedMessage(): Promise<string> {
  const settings = await getPlatformSettings()
  return settings.signupsPausedMessage?.trim() || DEFAULT_SIGNUPS_PAUSED_MESSAGE
}

export async function getPublicPlatformSettings() {
  const settings = await getPlatformSettings()
  return {
    signupsPaused: settings.signupsPaused,
    signupsPausedMessage: settings.signupsPausedMessage?.trim() || DEFAULT_SIGNUPS_PAUSED_MESSAGE,
  }
}
