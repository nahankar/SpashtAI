import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma'

export async function listSessions(_req: Request, res: Response) {
  try {
    const sessions = await prisma.session.findMany({
      orderBy: { startedAt: 'desc' },
      include: {
        user: {
          select: { id: true, email: true }
        }
      }
    })
    res.json({ sessions })
  } catch (error) {
    console.error('Error listing sessions:', error)
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
        transcript: true
      }
    })
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }
    
    res.json({ session })
  } catch (error) {
    console.error('Error getting session:', error)
    res.status(500).json({ error: 'Failed to get session' })
  }
}

export async function createSession(req: Request, res: Response) {
  try {
    const { id, module = 'elevate', startedAt } = req.body
    const userId = req.user!.userId

    const session = await prisma.session.create({
      data: {
        id,
        userId,
        module,
        startedAt: startedAt ? new Date(startedAt) : new Date(),
      },
      include: {
        user: {
          select: { id: true, email: true }
        }
      }
    })
    
    res.status(201).json({ success: true, session })
  } catch (error) {
    console.error('Error creating session:', error)
    res.status(500).json({ error: 'Failed to create session' })
  }
}

export async function endSession(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { endedAt, durationSec } = req.body
    
    const session = await prisma.session.update({
      where: { id },
      data: {
        endedAt: endedAt ? new Date(endedAt) : new Date(),
        durationSec,
      },
      include: {
        user: {
          select: { id: true, email: true }
        }
      }
    })
    
    res.json({ success: true, session })
  } catch (error) {
    console.error('Error ending session:', error)
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
    console.error('Error saving message:', error)
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
    console.error('Error saving transcript:', error)
    res.status(500).json({ error: 'Failed to save transcript' })
  }
}

export async function saveRecording(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const { egress_id, file_path, duration, file_size, status, recording_type } = req.body
    
    if (!egress_id || !file_path) {
      return res.status(400).json({ error: 'egress_id and file_path are required' })
    }
    
    // Convert status to string if it's a number (LiveKit sends integer status codes)
    const statusStr = typeof status === 'number' ? String(status) : (status || 'completed')
    
    // Ensure session exists
    const session = await prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }
    
    // Check if recording with this egress_id already exists
    const existingRecording = await prisma.sessionRecording.findUnique({
      where: { egressId: egress_id }
    })
    
    if (existingRecording) {
      // Update existing recording
      const recording = await prisma.sessionRecording.update({
        where: { egressId: egress_id },
        data: {
          filePath: file_path,
          duration: duration || 0,
          fileSize: file_size || 0,
          status: statusStr,
          recordingType: recording_type || 'user',
          updatedAt: new Date()
        }
      })
      console.log(`🎙️ Updated recording for session ${sessionId}: ${file_path} (${recording_type || 'user'})`)
      return res.status(200).json({ success: true, recording })
    }
    
    // Create new recording (supports multiple recordings per session)
    const recording = await prisma.sessionRecording.create({
      data: {
        sessionId: sessionId,
        egressId: egress_id,
        filePath: file_path,
        duration: duration || 0,
        fileSize: file_size || 0,
        status: statusStr,
        recordingType: recording_type || 'user'
      }
    })
    
    console.log(`🎙️ Saved recording for session ${sessionId}: ${file_path} (${recording_type || 'user'})`)
    res.status(201).json({ success: true, recording })
  } catch (error) {
    console.error('Error saving recording:', error)
    res.status(500).json({ error: 'Failed to save recording' })
  }
}

export async function deleteSession(req: Request, res: Response) {
  try {
    const { id } = req.params
    
    // Check if session exists
    const session = await prisma.session.findUnique({
      where: { id }
    })
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }
    
    // Delete the session (cascade will handle related data)
    // The schema has onDelete: Cascade for metrics, transcript, and recordings
    await prisma.session.delete({
      where: { id }
    })
    
    console.log(`🗑️  Deleted session: ${id}`)
    res.json({ success: true, message: 'Session deleted successfully' })
  } catch (error) {
    console.error('Error deleting session:', error)
    res.status(500).json({ error: 'Failed to delete session' })
  }
}




