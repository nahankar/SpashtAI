import type { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { logger, reqLog } from '../lib/logger'
import { awardSessionActivePoints } from '../lib/points'
import { isPrivilegedRole } from '../lib/userExportFlags'
import { enqueueSessionDeletion } from '../lib/sessionDeletionWorker'
import { queuePaceReconciliation } from '../lib/paceReconciliationWorker'
import {
  lockWritableSession,
  RecordingOwnershipError,
  SessionDiscardedError,
  SessionMissingError,
} from '../lib/sessionDiscard'
import { deleteRecordingArtifact } from '../lib/sessionStorageCleanup'
import { isValidInternalAgentRequest } from '../middleware/auth'

export async function listSessions(req: Request, res: Response) {
  try {
    // Non-privileged users only see their own sessions. Admins/super-admins
    // keep the full list so admin views don't regress.
    const where = isPrivilegedRole(req.user?.role)
      ? { discardedAt: null }
      : { userId: req.user!.userId, discardedAt: null }
    const sessions = await prisma.session.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      include: {
        user: {
          select: { id: true, email: true }
        }
      }
    })
    const deletionWhere = isPrivilegedRole(req.user?.role)
      ? { discardedAt: { not: null } }
      : { userId: req.user!.userId, discardedAt: { not: null } }
    const deletions = await prisma.session.findMany({
      where: deletionWhere,
      orderBy: { discardedAt: 'desc' },
      select: {
        id: true,
        sessionName: true,
        discardedAt: true,
        deletionStatus: true,
      },
    })
    res.json({ sessions, deletions })
  } catch (error) {
    logger.error({ err: error }, 'Error listing sessions:')
    res.status(500).json({ error: 'Failed to list sessions' })
  }
}

export async function getSession(req: Request, res: Response) {
  try {
    const { id } = req.params
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true }
        },
        metrics: true,
        transcript: true,
        preparationPractice: {
          select: {
            preparationId: true,
            stageId: true,
            preparation: { select: { title: true } },
            stage: { select: { name: true } },
          },
        },
      }
    })
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    // Ownership check: only the owner (or a privileged role) may read a session.
    if (!isPrivilegedRole(req.user?.role) && session.userId !== req.user?.userId) {
      return res.status(403).json({ error: 'Access denied' })
    }

    res.json({ session })
  } catch (error) {
    logger.error({ err: error }, 'Error getting session:')
    res.status(500).json({ error: 'Failed to get session' })
  }
}

export async function createSession(req: Request, res: Response) {
  try {
    const { id, module = 'elevate', startedAt, sessionName, focusArea, focusContext } = req.body
    const userId = req.user!.userId

    const session = await prisma.session.create({
      data: {
        id,
        userId,
        module,
        sessionName: sessionName?.trim() || null,
        focusArea: focusArea?.trim() || null,
        focusContext: focusContext?.trim() || null,
        startedAt: startedAt ? new Date(startedAt) : new Date(),
      },
      include: {
        user: {
          select: { id: true, email: true }
        }
      }
    })
    
    reqLog(req).info(
      { event: 'elevate.session_created', sessionId: session.id, module, focusArea: focusArea?.trim() || null },
      'session created',
    )
    res.status(201).json({ success: true, session })
  } catch (error) {
    logger.error({ err: error }, 'Error creating session:')
    res.status(500).json({ error: 'Failed to create session' })
  }
}

export async function endSession(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { endedAt, durationSec } = req.body

    const { session, alreadyEnded } = await prisma.$transaction(async (tx) => {
      await lockWritableSession(tx, id)
      const existing = await tx.session.findUnique({ where: { id } })
      if (!existing) throw new SessionMissingError()

      return {
        alreadyEnded: existing.endedAt != null,
        session: await tx.session.update({
          where: { id },
          data: {
            endedAt: endedAt ? new Date(endedAt) : existing.endedAt ?? new Date(),
            durationSec: durationSec ?? existing.durationSec,
            paceReconciliationStatus:
              existing.endedAt && existing.paceReconciliationStatus
                ? existing.paceReconciliationStatus
                : 'pending',
            nextPaceReconciliationAt:
              existing.endedAt && existing.paceReconciliationStatus
                ? existing.nextPaceReconciliationAt
                : new Date(),
          },
          include: {
            user: {
              select: { id: true, email: true, rewardPoints: true },
            },
          },
        }),
      }
    })

    let pointsAwarded = 0
    let totalPoints = session.user.rewardPoints
    if (!alreadyEnded) {
      try {
        const pts = await awardSessionActivePoints(session.userId, id)
        pointsAwarded = pts.awarded
        totalPoints = pts.total
      } catch (ptsErr) {
        logger.warn({ err: ptsErr, sessionId: id }, 'session points award skipped')
      }
    }

    reqLog(req).info(
      { event: 'elevate.session_ended', sessionId: id, durationSec: session.durationSec, pointsAwarded },
      'session ended',
    )
    // Agent turn persistence may finish before or after endedAt. Queue near-term
    // retries; the durable database sweep also repairs sessions after restarts.
    queuePaceReconciliation(id)
    res.json({ success: true, session, pointsAwarded, totalPoints })
  } catch (error) {
    if (error instanceof SessionDiscardedError || error instanceof SessionMissingError) {
      return res.status(error.status).json({ error: error.message })
    }
    logger.error({ err: error }, 'Error ending session:')
    res.status(500).json({ error: 'Failed to end session' })
  }
}

export async function saveMessage(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { role, content } = req.body
    
    if (!role || !content) {
      return res.status(400).json({ error: 'Role and content are required' })
    }
    
    // For now, just log the message and return success
    // TODO: Add database persistence for conversation messages
    console.log(`💾 Session ${id} - ${role}: ${content.substring(0, 100)}...`)
    
    res.status(201).json({ success: true, message: 'Message saved' })
  } catch (error) {
    logger.error({ err: error }, 'Error saving message:')
    res.status(500).json({ error: 'Failed to save message' })
  }
}

export async function saveTranscript(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { conversationData } = req.body
    
    if (!conversationData) {
      return res.status(400).json({ error: 'conversationData is required' })
    }
    
    // Upsert the transcript (create or update)
    const transcript = await prisma.sessionTranscript.upsert({
      where: { sessionId: id },
      update: {
        conversationData,
        updatedAt: new Date()
      },
      create: {
        sessionId: id,
        conversationData
      }
    })
    
    console.log(`📝 Saved transcript for session ${id} with ${conversationData.length} messages`)
    res.status(201).json({ success: true, transcript })
  } catch (error) {
    logger.error({ err: error }, 'Error saving transcript:')
    res.status(500).json({ error: 'Failed to save transcript' })
  }
}

export async function saveRecording(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const { egress_id, file_path, duration, file_size, status, recording_type } = req.body
    
    if (
      typeof egress_id !== 'string' ||
      !egress_id.trim() ||
      typeof file_path !== 'string' ||
      !file_path.trim()
    ) {
      return res.status(400).json({ error: 'egress_id and file_path are required' })
    }
    
    // Convert status to string if it's a number (LiveKit sends integer status codes)
    const statusStr = typeof status === 'number' ? String(status) : (status || 'completed')
    
    const isAgentCallback = isValidInternalAgentRequest(req)
    const result = await prisma.$transaction(async (tx) => {
      try {
        await lockWritableSession(tx, sessionId)
      } catch (error) {
        if (!(error instanceof SessionDiscardedError) || !isAgentCallback) throw error

        const existingDiscarded = await tx.sessionRecording.findUnique({
          where: { egressId: egress_id },
        })
        if (existingDiscarded && existingDiscarded.sessionId !== sessionId) {
          throw new RecordingOwnershipError()
        }

        // Persist the exact late Egress artifact as cleanup metadata and fence
        // any worker that took an earlier recording snapshot.
        if (existingDiscarded) {
          await tx.sessionRecording.update({
            where: { egressId: egress_id },
            data: {
              filePath: file_path,
              duration: duration || 0,
              fileSize: file_size || 0,
              status: statusStr,
              recordingType: recording_type || 'user',
            },
          })
        } else {
          await tx.sessionRecording.create({
            data: {
              sessionId,
              egressId: egress_id,
              filePath: file_path,
              duration: duration || 0,
              fileSize: file_size || 0,
              status: statusStr,
              recordingType: recording_type || 'user',
            },
          })
        }
        await tx.session.update({
          where: { id: sessionId },
          data: {
            deletionStatus: 'pending',
            nextDeletionAttemptAt: new Date(),
            deletionLeaseId: null,
            deletionLeaseUntil: null,
          },
        })
        return { discarded: true as const }
      }
      const existing = await tx.sessionRecording.findUnique({
        where: { egressId: egress_id },
      })
      if (existing) {
        if (existing.sessionId !== sessionId) {
          throw new RecordingOwnershipError()
        }
        return {
          discarded: false as const,
          created: false,
          recording: await tx.sessionRecording.update({
            where: { egressId: egress_id },
            data: {
              filePath: file_path,
              duration: duration || 0,
              fileSize: file_size || 0,
              status: statusStr,
              recordingType: recording_type || 'user',
              updatedAt: new Date(),
            },
          }),
        }
      }
      return {
        discarded: false as const,
        created: true,
        recording: await tx.sessionRecording.create({
          data: {
            sessionId,
            egressId: egress_id,
            filePath: file_path,
            duration: duration || 0,
            fileSize: file_size || 0,
            status: statusStr,
            recordingType: recording_type || 'user',
          },
        }),
      }
    })

    if (result.discarded) {
      enqueueSessionDeletion(sessionId)
      await deleteRecordingArtifact(file_path)
      return res.status(410).json({ error: 'Session discarded' })
    }
    
    console.log(`🎙️ Saved recording for session ${sessionId}: ${file_path} (${recording_type || 'user'})`)
    res.status(result.created ? 201 : 200).json({ success: true, recording: result.recording })
  } catch (error) {
    if (error instanceof RecordingOwnershipError) {
      return res.status(error.status).json({ error: error.message })
    }
    if (
      error instanceof SessionMissingError &&
      isValidInternalAgentRequest(req) &&
      typeof req.body?.file_path === 'string'
    ) {
      try {
        await deleteRecordingArtifact(req.body.file_path)
      } catch (cleanupError) {
        logger.error(
          { err: cleanupError, sessionId: req.params.sessionId },
          'Failed to compensate late Egress artifact for deleted session',
        )
        return res.status(503).json({ error: 'Recording cleanup pending retry' })
      }
    }
    if (error instanceof SessionDiscardedError || error instanceof SessionMissingError) {
      return res.status(error.status).json({ error: error.message })
    }
    logger.error({ err: error }, 'Error saving recording:')
    res.status(500).json({ error: 'Failed to save recording' })
  }
}

export async function deleteSession(req: Request, res: Response) {
  try {
    const { id } = req.params
    
    // Check if session exists
    const session = await prisma.session.findUnique({
      where: { id },
    })
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    // Ownership check: only the owner (or a privileged role) may delete a session.
    if (!isPrivilegedRole(req.user?.role) && session.userId !== req.user?.userId) {
      return res.status(403).json({ error: 'Access denied' })
    }

    if (!session.discardedAt) {
      const discardedAt = new Date()
      // The tombstone is the durable cleanup outbox. Keep this transaction
      // independent from best-effort denormalized cleanup such as Pulse.
      await prisma.$transaction(async (tx) => {
        await tx.session.update({
          where: { id },
          data: {
            discardedAt,
            deletionStatus: 'pending',
            deletionAttempts: 0,
            deletionError: null,
            nextDeletionAttemptAt: discardedAt,
          },
        })
      })
    } else {
      // A repeated DELETE is an idempotent request to retry cleanup now.
      await prisma.session.update({
        where: { id },
        data: {
          deletionStatus: 'pending',
          nextDeletionAttemptAt: new Date(),
        },
      })
    }

    // Tombstoned sessions are already hidden by every read path. Pulse cleanup
    // is immediate when possible and is retried by the durable worker otherwise.
    await prisma.progressPulse.deleteMany({
      where: { sessionId: id, source: 'elevate' },
    }).catch((error) => {
      logger.warn({ err: error, sessionId: id }, 'Deferred Pulse cleanup for discarded session')
    })

    enqueueSessionDeletion(id)

    res.status(202).json({
      success: true,
      deletionStatus: 'pending',
      message: 'Session is being securely discarded',
    })
  } catch (error) {
    const prismaError =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? { prismaCode: error.code, prismaMeta: error.meta }
        : {}
    logger.error({ err: error, sessionId: req.params.id, ...prismaError }, 'Error deleting session:')
    res.status(500).json({ error: 'Failed to delete session' })
  }
}




