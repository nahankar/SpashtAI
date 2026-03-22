import type { Request, Response } from 'express'
import { DataPacket_Kind, RoomServiceClient } from 'livekit-server-sdk'

// Placeholder: Text-in → Text-out. Replace with AWS Bedrock NovaSonic streaming when wired.
export async function assistantText(req: Request, res: Response) {
  const { text, persona, room } = (req.body ?? {}) as { text?: string; persona?: string; room?: string }
  if (!text) return res.status(400).json({ error: 'text is required' })

  // TODO: If AWS creds exist, call Bedrock model here and stream back tokens/audio.
  const reply = `(${persona || 'interviewer'}) Thanks, I heard: ${text}`

  // Broadcast assistant reply as a data message to room (if provided)
  try {
    if (room) {
      const url = process.env.LIVEKIT_URL || ''
      const httpUrl = url.startsWith('wss://') ? url.replace('wss://', 'https://') : url.replace('ws://', 'http://')
      const apiKey = process.env.LIVEKIT_API_KEY || ''
      const apiSecret = process.env.LIVEKIT_API_SECRET || ''
      if (httpUrl && apiKey && apiSecret) {
        const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret)
        const payload = Buffer.from(JSON.stringify({ type: 'assistant', text: reply }))
        await svc.sendData(room, payload, DataPacket_Kind.RELIABLE)
      }
    }
  } catch (e) {
    // non-fatal for the HTTP response
  }

  res.json({ reply })
}


