import path from 'node:path'
import type { WorkspaceTx, establishWorkspace } from './context'
import { replayTranscriptionCachePath } from '../lib/replayDeletionWorker'
import { transcriptionInputUri } from '../lib/aws-transcribe'
import { runWithDataScope } from '../lib/dataScope'
import { workspaceMediaPrefix } from '../lib/mediaStorage'

/** Must run after manager/target validation, before deleting the target membership. */
export async function eraseMemberHistory(tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>, userId: string) {
  const where = { workspaceId: scope.workspace.id, userId }
  const now = new Date()
  const sessions = await tx.session.updateMany({ where: { ...where, discardedAt: null }, data: {
    discardedAt: now, deletionStatus: 'pending', deletionAttempts: 0, deletionError: null, nextDeletionAttemptAt: now,
  } })
  const replays = await tx.replaySession.findMany({ where, include: { uploadedFiles: true } })
  const replayJobs = replays.map(replay => {
    const cache = runWithDataScope({ actorId: scope.member.userId, workspaceId: scope.workspace.id,
      membershipId: scope.member.id, role: scope.member.role, slug: scope.workspace.slug,
      timeZone: scope.workspace.timeZone, features: {}, origin: 'request' }, () => replayTranscriptionCachePath(replay.id))
    const filePaths = [...replay.uploadedFiles.map(file => file.storedPath), cache,
      ...(process.env.NODE_ENV === 'production' ? replay.uploadedFiles.filter(file => ['audio', 'video'].includes(file.fileType))
        .map(file => transcriptionInputUri(`${workspaceMediaPrefix(scope.workspace.id, 'replay', replay.id)}/${path.basename(file.storedPath)}`)) : [])]
    return { replaySessionId: replay.id, workspaceId: scope.workspace.id, filePaths }
  })
  if (replayJobs.length) await tx.replayDeletion.createMany({ data: replayJobs, skipDuplicates: true })
  const feedback = await tx.userFeedback.findMany({ where, include: { attachments: true } })
  const feedbackJobs = feedback.filter(item => item.attachments.length).map(item => ({
    replaySessionId: `feedback-${item.id}`, workspaceId: scope.workspace.id,
    filePaths: item.attachments.map(file => file.storedPath),
  }))
  if (feedbackJobs.length) await tx.replayDeletion.createMany({ data: feedbackJobs, skipDuplicates: true })
  // Parent cascades remove transcript/evaluation/coach/feedback child rows. Session media is
  // removed by the durable tombstone worker, which also disconnects active voice rooms.
  await tx.coachThread.deleteMany({ where })
  await tx.preparation.deleteMany({ where })
  await tx.replaySession.deleteMany({ where })
  await tx.coachHomeResultReceipt.deleteMany({ where })
  await tx.userFeedback.deleteMany({ where })
  await tx.progressPulse.deleteMany({ where })
  await tx.featureUsage.deleteMany({ where })
  await tx.workspaceAnalyticsQuery.deleteMany({ where: { workspaceId: scope.workspace.id, authorId: userId } })
  return { sessionsQueued: sessions.count, replaysDeleted: replays.length, feedbackDeleted: feedback.length }
}
