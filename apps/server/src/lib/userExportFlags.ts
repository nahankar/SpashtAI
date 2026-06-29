import type { Request, Response } from 'express'
import { prisma } from './prisma'

export interface UserExportFlags {
  hideTranscriptText: boolean
  hideTranscriptJsonExport: boolean
  hideAudioDownload: boolean
  // Capability flags for the download/reprocess action buttons. Default OFF;
  // only true once an admin enables them (privileged users get all true).
  enableTxtExport: boolean
  enableJsonExport: boolean
  enableAudioExport: boolean
  enableReprocess: boolean
}

// "Unrestricted" defaults used for privileged (admin) users: nothing hidden and
// every export/reprocess action enabled.
export const DEFAULT_EXPORT_FLAGS: UserExportFlags = {
  hideTranscriptText: false,
  hideTranscriptJsonExport: false,
  hideAudioDownload: false,
  enableTxtExport: true,
  enableJsonExport: true,
  enableAudioExport: true,
  enableReprocess: true,
}

export function isPrivilegedRole(role?: string): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

export async function fetchUserExportFlags(userId: string): Promise<UserExportFlags> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      hideTranscriptText: true,
      hideTranscriptJsonExport: true,
      hideAudioDownload: true,
      enableTxtExport: true,
      enableJsonExport: true,
      enableAudioExport: true,
      enableReprocess: true,
    },
  })
  if (!user) {
    // Unknown user: nothing hidden, but no export/reprocess actions enabled.
    return {
      hideTranscriptText: false,
      hideTranscriptJsonExport: false,
      hideAudioDownload: false,
      enableTxtExport: false,
      enableJsonExport: false,
      enableAudioExport: false,
      enableReprocess: false,
    }
  }
  return {
    hideTranscriptText: user.hideTranscriptText,
    hideTranscriptJsonExport: user.hideTranscriptJsonExport,
    hideAudioDownload: user.hideAudioDownload,
    enableTxtExport: user.enableTxtExport,
    enableJsonExport: user.enableJsonExport,
    enableAudioExport: user.enableAudioExport,
    enableReprocess: user.enableReprocess,
  }
}

export async function getEffectiveExportFlags(
  userId: string,
  role?: string,
): Promise<UserExportFlags> {
  if (isPrivilegedRole(role)) return DEFAULT_EXPORT_FLAGS
  return fetchUserExportFlags(userId)
}

export async function getElevateSessionOwnerId(sessionId: string): Promise<string | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { userId: true },
  })
  return session?.userId ?? null
}

export async function getReplaySessionOwnerId(replaySessionId: string): Promise<string | null> {
  const session = await prisma.replaySession.findUnique({
    where: { id: replaySessionId },
    select: { userId: true },
  })
  return session?.userId ?? null
}

export function exportDenied(res: Response, message: string): Response {
  return res.status(403).json({ error: message })
}

/** Resolve export flags for the authenticated user viewing their own session. */
export async function resolveRequestExportFlags(
  req: Request,
  ownerUserId: string | null,
): Promise<{ flags: UserExportFlags; accessDenied: boolean }> {
  if (!req.user) {
    // No authenticated user: nothing hidden, but no export actions enabled.
    return {
      flags: {
        hideTranscriptText: false,
        hideTranscriptJsonExport: false,
        hideAudioDownload: false,
        enableTxtExport: false,
        enableJsonExport: false,
        enableAudioExport: false,
        enableReprocess: false,
      },
      accessDenied: false,
    }
  }

  if (isPrivilegedRole(req.user.role)) {
    return { flags: DEFAULT_EXPORT_FLAGS, accessDenied: false }
  }

  if (ownerUserId && ownerUserId !== req.user.userId) {
    return { flags: DEFAULT_EXPORT_FLAGS, accessDenied: true }
  }

  const flags = await fetchUserExportFlags(req.user.userId)
  return { flags, accessDenied: false }
}

export function stripReplayTranscriptFields<T extends Record<string, unknown>>(result: T): T {
  const copy = { ...result }
  delete copy.transcriptText
  delete copy.annotatedTranscript
  delete copy.structuredTranscript
  return copy
}
