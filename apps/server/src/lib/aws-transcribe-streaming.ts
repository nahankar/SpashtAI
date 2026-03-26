// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  DEV-ONLY: AWS Transcribe Streaming (no S3 needed)                  ║
// ║  Remove this file before production deployment.                     ║
// ║  Production should use aws-transcribe.ts (S3 + batch Transcribe).   ║
// ╚═══════════════════════════════════════════════════════════════════════╝

import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  type StartStreamTranscriptionCommandOutput,
} from '@aws-sdk/client-transcribe-streaming'
import { readFileSync, existsSync, unlinkSync } from 'fs'
import { execSync } from 'child_process'
import type { TranscriptionResult, TranscribedSegment } from './aws-transcribe'

const region = process.env.AWS_REGION || process.env.BEDROCK_REGION || 'us-east-1'

const streamingClient = new TranscribeStreamingClient({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

function cleanupTemp(tempFile?: string) {
  if (tempFile && existsSync(tempFile)) {
    try { unlinkSync(tempFile) } catch { /* best effort */ }
  }
}

/**
 * Convert any audio file to 16-bit signed LE PCM at 16kHz mono via ffmpeg.
 * This is the most reliable format for Transcribe Streaming.
 */
function convertToPcm(filePath: string): { pcmPath: string; sampleRate: number } {
  const pcmPath = filePath.replace(/\.[^.]+$/, '_transcribe.pcm')
  console.log(`[dev-streaming] Converting to PCM: ${pcmPath}`)
  execSync(
    `ffmpeg -y -i "${filePath}" -f s16le -acodec pcm_s16le -ar 16000 -ac 1 "${pcmPath}"`,
    { timeout: 120_000, stdio: 'pipe' }
  )
  return { pcmPath, sampleRate: 16000 }
}

/**
 * Build an async generator that yields audio chunks from a buffer.
 * Sends at roughly real-time pace to avoid overwhelming the stream.
 */
async function* audioChunkGenerator(
  audioBuffer: Buffer,
  sampleRate: number
): AsyncGenerator<{ AudioEvent: { AudioChunk: Uint8Array } }> {
  const CHUNK_SIZE = 8192 // ~256ms of 16kHz 16-bit mono audio
  const bytesPerSecond = sampleRate * 2 // 16-bit = 2 bytes per sample
  const chunkDurationMs = (CHUNK_SIZE / bytesPerSecond) * 1000

  let offset = 0
  let chunkCount = 0
  while (offset < audioBuffer.length) {
    const end = Math.min(offset + CHUNK_SIZE, audioBuffer.length)
    const slice = audioBuffer.subarray(offset, end)
    yield { AudioEvent: { AudioChunk: new Uint8Array(slice) } }
    offset = end
    chunkCount++

    if (chunkCount % 500 === 0) {
      const pct = ((offset / audioBuffer.length) * 100).toFixed(1)
      console.log(`[dev-streaming] Sent ${chunkCount} chunks (${pct}%)`)
    }

    // Pace at ~4x real-time to give Transcribe breathing room
    await new Promise((r) => setTimeout(r, chunkDurationMs / 4))
  }
  console.log(`[dev-streaming] Audio stream complete: ${chunkCount} chunks sent`)
}

export async function transcribeStreamingFromFile(
  filePath: string,
  mimeType: string,
  maxSpeakers = 10
): Promise<TranscriptionResult> {
  console.log(`[dev-streaming] Starting transcription for: ${filePath} (${mimeType})`)

  // Always convert to PCM — most reliable format for Transcribe Streaming
  let pcmPath: string
  let sampleRate: number
  try {
    const result = convertToPcm(filePath)
    pcmPath = result.pcmPath
    sampleRate = result.sampleRate
  } catch (err: any) {
    throw new Error(`[dev-streaming] ffmpeg conversion failed: ${err.message}`)
  }

  const audioBuffer = readFileSync(pcmPath)
  const durationSec = audioBuffer.length / (sampleRate * 2)
  console.log(`[dev-streaming] PCM file: ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB, ~${Math.round(durationSec)}s duration`)

  const command = new StartStreamTranscriptionCommand({
    LanguageCode: 'en-US',
    MediaEncoding: 'pcm',
    MediaSampleRateHertz: sampleRate,
    AudioStream: audioChunkGenerator(audioBuffer, sampleRate),
    ShowSpeakerLabel: true,
  })

  console.log(`[dev-streaming] Sending to AWS Transcribe Streaming...`)

  let response: StartStreamTranscriptionCommandOutput
  try {
    response = await streamingClient.send(command)
  } catch (err: any) {
    cleanupTemp(pcmPath)
    console.error(`[dev-streaming] send() failed: ${err.name}: ${err.message}`)
    throw new Error(`Transcribe Streaming failed: ${err.message || err.name || 'Unknown error'}`)
  }

  console.log(`[dev-streaming] Connection established, SessionId: ${response.SessionId}`)

  if (!response.TranscriptResultStream) {
    cleanupTemp(pcmPath)
    throw new Error('No transcript result stream received from AWS Transcribe Streaming')
  }

  const allItems: { speaker: string; content: string; startTime: number; endTime: number; type: string }[] = []
  let eventCount = 0

  try {
    for await (const event of response.TranscriptResultStream) {
      eventCount++
      if (eventCount === 1) {
        console.log(`[dev-streaming] First event received, keys: ${Object.keys(event).join(', ')}`)
      }

      // SDK v3: events are directly typed — TranscriptEvent is a property
      const transcriptEvent = (event as any).TranscriptEvent
      if (!transcriptEvent) continue

      const results = transcriptEvent.Transcript?.Results || []
      for (const result of results) {
        if (result.IsPartial) continue

        const items = result.Alternatives?.[0]?.Items || []
        for (const item of items) {
          allItems.push({
            speaker: item.Speaker || 'spk_0',
            content: item.Content || '',
            startTime: item.StartTime || 0,
            endTime: item.EndTime || 0,
            type: item.Type || 'pronunciation',
          })
        }
      }

      if (eventCount % 100 === 0) {
        console.log(`[dev-streaming] ${eventCount} events processed, ${allItems.length} final items so far`)
      }
    }
  } catch (streamErr: any) {
    console.error(`[dev-streaming] Stream iteration error: ${streamErr.name}: ${streamErr.message}`)
    // Continue with whatever items we collected
  }

  cleanupTemp(pcmPath)
  console.log(`[dev-streaming] Stream complete: ${eventCount} events, ${allItems.length} final items`)

  if (allItems.length === 0) {
    throw new Error(
      `Streaming transcription returned no results after ${eventCount} events. ` +
      'Ensure the audio file contains speech content.'
    )
  }

  // Group items into speaker segments (merge consecutive items from same speaker)
  const segments: TranscribedSegment[] = []
  let currentSeg: TranscribedSegment | null = null

  for (const item of allItems) {
    if (item.type === 'punctuation') {
      if (currentSeg) {
        currentSeg.text += item.content
      }
      continue
    }

    if (currentSeg && currentSeg.speaker === item.speaker) {
      currentSeg.text += ' ' + item.content
      currentSeg.endTime = item.endTime
    } else {
      if (currentSeg) segments.push(currentSeg)
      currentSeg = {
        speaker: item.speaker,
        text: item.content,
        startTime: item.startTime,
        endTime: item.endTime,
        confidence: 0.9,
      }
    }
  }
  if (currentSeg) segments.push(currentSeg)

  const fullText = segments.map((s) => s.text).join(' ')
  const speakerSet = new Set(segments.map((s) => s.speaker))

  console.log(`[dev-streaming] Done: ${segments.length} segments, ${speakerSet.size} speakers, ${fullText.split(/\s+/).length} words`)

  return {
    fullText,
    segments,
    speakerCount: speakerSet.size || 1,
  }
}
