import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  TranscriptionJobStatus,
} from '@aws-sdk/client-transcribe'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFile } from 'fs/promises'

const region = process.env.AWS_REGION || 'us-east-1'
const isDev = process.env.NODE_ENV !== 'production'

const S3_BUCKET_DEV = process.env.S3_BUCKET_DEV || 'spashtai-review-dev'
const S3_BUCKET_PROD = process.env.S3_BUCKET_PROD || 'spashtai-review-prod'
const S3_BUCKET = isDev ? S3_BUCKET_DEV : S3_BUCKET_PROD

const transcribeClient = new TranscribeClient({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

export interface TranscribedSegment {
  speaker: string
  text: string
  startTime: number
  endTime: number
  confidence: number
}

export interface TranscriptionResult {
  fullText: string
  segments: TranscribedSegment[]
  speakerCount: number
}

export async function uploadToS3(
  localPath: string,
  s3Key: string,
  mimeType: string
): Promise<string> {
  const fileBuffer = await readFile(localPath)
  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: mimeType,
    })
  )
  return `s3://${S3_BUCKET}/${s3Key}`
}

export async function startTranscriptionJob(
  s3Uri: string,
  jobName: string,
  mediaFormat: string
): Promise<string> {
  await transcribeClient.send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      Media: { MediaFileUri: s3Uri },
      MediaFormat: mediaFormat as any,
      LanguageCode: 'en-US',
      Settings: {
        ShowSpeakerLabels: true,
        MaxSpeakerLabels: 10,
      },
    })
  )
  return jobName
}

export async function pollTranscriptionJob(
  jobName: string,
  maxWaitMs = 600_000
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const resp = await transcribeClient.send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: jobName })
    )
    const status = resp.TranscriptionJob?.TranscriptionJobStatus
    if (status === TranscriptionJobStatus.COMPLETED) {
      return resp.TranscriptionJob!.Transcript!.TranscriptFileUri!
    }
    if (status === TranscriptionJobStatus.FAILED) {
      throw new Error(
        `Transcription failed: ${resp.TranscriptionJob?.FailureReason}`
      )
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('Transcription job timed out')
}

export async function fetchTranscriptionResult(
  transcriptUri: string
): Promise<TranscriptionResult> {
  const resp = await fetch(transcriptUri)
  const data = await resp.json()

  const items: any[] = data.results?.items ?? []
  const speakerLabels: any =
    data.results?.speaker_labels ?? {}
  const segments: any[] = speakerLabels.segments ?? []

  const transcribedSegments: TranscribedSegment[] = segments.map((seg: any) => ({
    speaker: seg.speaker_label ?? 'spk_0',
    text: seg.items
      ?.map((i: any) => {
        const matching = items.find(
          (it: any) => it.start_time === i.start_time && it.end_time === i.end_time
        )
        return matching?.alternatives?.[0]?.content ?? ''
      })
      .join(' ') ?? '',
    startTime: parseFloat(seg.start_time ?? '0'),
    endTime: parseFloat(seg.end_time ?? '0'),
    confidence:
      seg.items?.reduce(
        (sum: number, i: any) =>
          sum + parseFloat(i.alternatives?.[0]?.confidence ?? '0'),
        0
      ) / (seg.items?.length || 1),
  }))

  const fullText = data.results?.transcripts?.[0]?.transcript ?? ''
  const speakerSet = new Set(transcribedSegments.map((s) => s.speaker))

  return {
    fullText,
    segments: transcribedSegments,
    speakerCount: speakerSet.size || 1,
  }
}

export function mediaFormatFromMime(mimeType: string): string {
  if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'mp3'
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('flac')) return 'flac'
  if (mimeType.includes('webm')) return 'webm'
  return 'mp4'
}
