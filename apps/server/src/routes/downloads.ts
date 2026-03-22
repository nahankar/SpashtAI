import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';

const router = Router();

// Download conversation transcript
router.get('/sessions/:sessionId/transcript', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    
    // Get session transcript from database
    const sessionTranscript = await prisma.sessionTranscript.findUnique({
      where: { sessionId }
    });
    
    if (!sessionTranscript) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Get session metrics separately
    const sessionMetrics = await prisma.sessionMetrics.findUnique({
      where: { sessionId }
    });
    
    // Parse conversation data
    const conversationData = sessionTranscript.conversationData as any;
    const messages = conversationData?.messages || [];
    
    // Create transcript text
    const transcript = messages.map((msg: any) => {
      const timestamp = new Date(msg.timestamp).toLocaleString();
      const role = msg.role === 'user' ? 'You' : 'Assistant';
      return `[${timestamp}] ${role}: ${msg.content}`;
    }).join('\n\n');
    
    // Add session metadata
    const header = `SpashtAI Interview Session Transcript
Session ID: ${sessionId}
Date: ${sessionTranscript.createdAt.toLocaleString()}
Duration: ${sessionMetrics?.userSpeakingTime ? Math.round(sessionMetrics.userSpeakingTime) + 's' : 'Unknown'}
Total Messages: ${messages.length}

----------------------------------------

`;
    
    const fullTranscript = header + transcript;
    
    // Set headers for download
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="transcript-${sessionId}.txt"`);
    
    res.send(fullTranscript);
  } catch (error) {
    console.error('Error downloading transcript:', error);
    res.status(500).json({ error: 'Failed to download transcript' });
  }
});

// Download conversation transcript as JSON
router.get('/sessions/:sessionId/transcript.json', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    
    // Get session transcript from database
    const sessionTranscript = await prisma.sessionTranscript.findUnique({
      where: { sessionId }
    });
    
    if (!sessionTranscript) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Get session metrics separately  
    const sessionMetrics = await prisma.sessionMetrics.findUnique({
      where: { sessionId }
    });
    
    // Create structured data
    const exportData = {
      sessionId,
      createdAt: sessionTranscript.createdAt,
      conversationData: sessionTranscript.conversationData,
      metrics: sessionMetrics,
      exportedAt: new Date().toISOString()
    };
    
    // Set headers for download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="transcript-${sessionId}.json"`);
    
    res.json(exportData);
  } catch (error) {
    console.error('Error downloading JSON transcript:', error);
    res.status(500).json({ error: 'Failed to download transcript' });
  }
});

// List available audio files for a session
router.get('/sessions/:sessionId/audio', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const environment = process.env.ENVIRONMENT || 'development';
    
    if (environment === 'development') {
      // List local audio files
      const audioDir = path.join(process.cwd(), '../../temp_audio');
      
      try {
        const files = await fs.readdir(audioDir);
        const sessionFiles = files.filter(file => 
          file.includes(sessionId) && (file.endsWith('.wav') || file.endsWith('.mp3'))
        );
        
        const audioFiles = sessionFiles.map(file => ({
          filename: file,
          url: `/api/downloads/sessions/${sessionId}/audio/${file}`,
          size: null // Could add file size if needed
        }));
        
        res.json({ audioFiles });
      } catch (error) {
        res.json({ audioFiles: [] });
      }
    } else {
      // S3 implementation would go here
      res.json({ 
        audioFiles: [],
        message: 'S3 audio listing not implemented yet'
      });
    }
  } catch (error) {
    console.error('Error listing audio files:', error);
    res.status(500).json({ error: 'Failed to list audio files' });
  }
});

// Download specific audio file
router.get('/sessions/:sessionId/audio/:filename', async (req, res) => {
  try {
    const { sessionId, filename } = req.params;
    const environment = process.env.ENVIRONMENT || 'development';
    
    // Validate filename to prevent path traversal
    const safeName = path.basename(filename);
    if (!safeName.includes(sessionId)) {
      return res.status(403).json({ error: 'Invalid file access' });
    }
    
    if (environment === 'development') {
      const audioDir = path.join(process.cwd(), '../../temp_audio');
      const filePath = path.join(audioDir, safeName);
      
      try {
        const stats = await fs.stat(filePath);
        const fileStream = await fs.readFile(filePath);
        
        // Set appropriate headers
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        
        res.send(fileStream);
      } catch (error) {
        res.status(404).json({ error: 'Audio file not found' });
      }
    } else {
      // S3 implementation would go here
      res.status(501).json({ error: 'S3 audio download not implemented yet' });
    }
  } catch (error) {
    console.error('Error downloading audio file:', error);
    res.status(500).json({ error: 'Failed to download audio file' });
  }
});

// Download all session data as ZIP
router.get('/sessions/:sessionId/export', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    
    // This would create a ZIP file with transcript + audio files
    // For now, just return the transcript
    const sessionTranscript = await prisma.sessionTranscript.findUnique({
      where: { sessionId }
    });
    
    if (!sessionTranscript) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json({
      message: 'ZIP export not implemented yet',
      availableDownloads: {
        transcript: `/api/downloads/sessions/${sessionId}/transcript`,
        transcriptJson: `/api/downloads/sessions/${sessionId}/transcript.json`,
        audio: `/api/downloads/sessions/${sessionId}/audio`
      }
    });
  } catch (error) {
    console.error('Error exporting session:', error);
    res.status(500).json({ error: 'Failed to export session' });
  }
});

export default router;