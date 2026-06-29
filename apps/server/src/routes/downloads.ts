import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';
import {
  exportDenied,
  getElevateSessionOwnerId,
  resolveRequestExportFlags,
} from '../lib/userExportFlags';

const router = Router();

// Each download action is gated by BOTH a "hide" view flag (content restricted)
// and an "enable" capability flag (admin must turn the action on). The action
// is allowed only when it is not hidden AND it is enabled.
const EXPORT_FLAG_MAP = {
  hideTranscriptText: 'enableTxtExport',
  hideTranscriptJsonExport: 'enableJsonExport',
  hideAudioDownload: 'enableAudioExport',
} as const;

async function guardSessionExport(
  req: Request,
  res: Response,
  sessionId: string,
  flag: keyof typeof EXPORT_FLAG_MAP,
  message: string,
) {
  const ownerId = await getElevateSessionOwnerId(sessionId);
  const { flags, accessDenied } = await resolveRequestExportFlags(req, ownerId);
  if (accessDenied) {
    exportDenied(res, 'Access denied');
    return false;
  }
  if (flags[flag]) {
    exportDenied(res, message);
    return false;
  }
  if (!flags[EXPORT_FLAG_MAP[flag]]) {
    exportDenied(res, message);
    return false;
  }
  return true;
}

// Download conversation transcript
router.get('/sessions/:sessionId/transcript', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    if (!(await guardSessionExport(req, res, sessionId, 'hideTranscriptText', 'Transcript download is disabled for your account'))) {
      return;
    }
    
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
    if (!(await guardSessionExport(req, res, sessionId, 'hideTranscriptJsonExport', 'Transcript JSON export is disabled for your account'))) {
      return;
    }
    
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
    if (!(await guardSessionExport(req, res, sessionId, 'hideAudioDownload', 'Audio download is disabled for your account'))) {
      return;
    }
    // Source of truth is the SessionRecording table (browser/egress uploads),
    // NOT a hard-coded temp dir. The old code scanned ../../temp_audio for
    // *.wav/*.mp3 only, so client-captured *.webm recordings (the dev default)
    // were never listed → "No user audio file found".
    const recordings = await prisma.sessionRecording.findMany({
      where: { sessionId, status: 'completed' },
      orderBy: { createdAt: 'desc' },
    });
    const audioFiles = recordings
      .filter((r) => r.filePath)
      .map((r) => ({
        filename: path.basename(r.filePath as string),
        url: `/api/downloads/sessions/${sessionId}/audio/${encodeURIComponent(
          path.basename(r.filePath as string),
        )}`,
        size: r.fileSize ?? null,
        recordingType: r.recordingType,
      }));
    res.json({ audioFiles });
  } catch (error) {
    console.error('Error listing audio files:', error);
    res.status(500).json({ error: 'Failed to list audio files' });
  }
});

// Download specific audio file
router.get('/sessions/:sessionId/audio/:filename', async (req, res) => {
  try {
    const { sessionId, filename } = req.params;
    if (!(await guardSessionExport(req, res, sessionId, 'hideAudioDownload', 'Audio download is disabled for your account'))) {
      return;
    }
    // Validate filename to prevent path traversal
    const safeName = path.basename(decodeURIComponent(filename));

    // Resolve via the SessionRecording table so the absolute upload path (any
    // extension: webm/m4a/wav/...) is served, instead of guessing a temp dir.
    const recordings = await prisma.sessionRecording.findMany({
      where: { sessionId, status: 'completed' },
    });
    const rec = recordings.find(
      (r) => r.filePath && path.basename(r.filePath) === safeName,
    );
    if (!rec?.filePath) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    const mimeByExt: Record<string, string> = {
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      mp4: 'video/mp4',
      webm: 'audio/webm',
      ogg: 'audio/ogg',
    };
    const ext = safeName.split('.').pop()?.toLowerCase();
    try {
      const stats = await fs.stat(rec.filePath);
      const fileBuffer = await fs.readFile(rec.filePath);
      res.setHeader('Content-Type', (ext && mimeByExt[ext]) || 'application/octet-stream');
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.send(fileBuffer);
    } catch (error) {
      res.status(404).json({ error: 'Audio file not found' });
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