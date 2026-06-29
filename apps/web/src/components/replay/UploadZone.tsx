import { useState, useRef, type DragEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Upload, X, FileAudio, FileText, Film, Lock } from 'lucide-react'
import { useIsPro } from '@/hooks/useIsPro'
import { useIsUltra } from '@/hooks/useIsUltra'

const AUDIO_TYPES = ['.mp3', '.mp4', '.wav', '.m4a', '.ogg', '.mov', '.webm']
const TEXT_TYPES = ['.txt', '.json', '.srt', '.vtt']
// Audio-only accept hint for users without the Ultra plan (video blocked).
const AUDIO_ONLY_TYPES = ['.mp3', '.wav', '.m4a', '.ogg']
const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v']

/** A file counts as video by its MIME type, falling back to extension. */
function isVideoFile(f: File): boolean {
  if (f.type) return f.type.startsWith('video/')
  const ext = '.' + (f.name.split('.').pop()?.toLowerCase() ?? '')
  return VIDEO_EXTS.includes(ext)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(type: string) {
  if (type.startsWith('audio/')) return <FileAudio className="h-5 w-5 text-blue-500" />
  if (type.startsWith('video/')) return <Film className="h-5 w-5 text-purple-500" />
  return <FileText className="h-5 w-5 text-green-500" />
}

interface UploadZoneProps {
  onSubmit: (files: { audio?: File; transcript?: File; text?: string }) => void
  loading?: boolean
}

export function UploadZone({ onSubmit, loading }: UploadZoneProps) {
  const isPro = useIsPro()
  const isUltra = useIsUltra()
  // Tiered plans: Free = transcript/text only, Pro adds audio, Ultra adds video.
  // Ultra is treated as a superset of Pro. Admins satisfy both.
  const canAudio = isPro || isUltra
  const canVideo = isUltra
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null)
  const [pastedText, setPastedText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const transcriptRef = useRef<HTMLInputElement>(null)

  /** Accept a media file, gating audio behind Pro and video behind Ultra. */
  const selectAudioFile = (f: File) => {
    if (isVideoFile(f)) {
      if (!canVideo) {
        setBlockedMsg(
          'Video uploads are an Ultra plan feature. Upload an audio file or a transcript instead, or contact your admin to enable Ultra.',
        )
        return
      }
    } else if (!canAudio) {
      setBlockedMsg(
        'Audio uploads are a Pro plan feature. Upload a transcript or paste text instead, or contact your admin to enable Pro.',
      )
      return
    }
    setBlockedMsg(null)
    setAudioFile(f)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    for (const f of files) {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase()
      if (AUDIO_TYPES.includes(ext) || isVideoFile(f)) {
        selectAudioFile(f)
      } else if (TEXT_TYPES.includes(ext)) {
        setTranscriptFile(f)
      }
    }
  }

  const hasContent = audioFile || transcriptFile || pastedText.trim()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Recording or Transcript</CardTitle>
        <CardDescription>
          Upload an audio/video recording, a transcript file, paste text directly, or combine them for best results.
          For VTT files, we try to detect the real-world meeting date from the file name or header before asking you
          manually (needed for Progress Pulse trends).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            dragging
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/50'
          }`}
        >
          <Upload className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium">Drag & drop files here</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              Audio: MP3, WAV, M4A, OGG (max 500MB)
              {!canAudio && (
                <Badge
                  variant="secondary"
                  className="px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide"
                >
                  <Lock className="mr-1 h-2.5 w-2.5" /> Pro
                </Badge>
              )}
            </span>
            <br />
            <span className="inline-flex items-center gap-1">
              Video: MP4, MOV, WebM
              {!canVideo && (
                <Badge
                  variant="secondary"
                  className="px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide"
                >
                  <Lock className="mr-1 h-2.5 w-2.5" /> Ultra
                </Badge>
              )}
            </span>
            <br />
            Text: TXT, JSON, SRT, VTT (max 10MB)
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => audioRef.current?.click()}
            >
              {canVideo ? 'Choose Audio/Video' : 'Choose Audio'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => transcriptRef.current?.click()}
            >
              Choose Transcript
            </Button>
          </div>
          <input
            ref={audioRef}
            type="file"
            accept={(canVideo ? AUDIO_TYPES : AUDIO_ONLY_TYPES).join(',')}
            className="hidden"
            onChange={(e) => e.target.files?.[0] && selectAudioFile(e.target.files[0])}
          />
          <input
            ref={transcriptRef}
            type="file"
            accept={TEXT_TYPES.join(',')}
            className="hidden"
            onChange={(e) => e.target.files?.[0] && setTranscriptFile(e.target.files[0])}
          />
        </div>

        {blockedMsg && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{blockedMsg}</span>
          </div>
        )}

        {/* Selected files */}
        {(audioFile || transcriptFile) && (
          <div className="grid gap-2">
            {audioFile && (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  {fileIcon(audioFile.type)}
                  <span className="font-medium">{audioFile.name}</span>
                  <span className="text-muted-foreground">({formatSize(audioFile.size)})</span>
                </div>
                <button onClick={() => setAudioFile(null)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {transcriptFile && (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  {fileIcon(transcriptFile.type)}
                  <span className="font-medium">{transcriptFile.name}</span>
                  <span className="text-muted-foreground">({formatSize(transcriptFile.size)})</span>
                </div>
                <button onClick={() => setTranscriptFile(null)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Paste text */}
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or paste text directly</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <Label htmlFor="pastedText" className="sr-only">Paste transcript text</Label>
          <Textarea
            id="pastedText"
            placeholder="Paste your meeting transcript here...&#10;&#10;Speaker 1: Hello, thanks for joining.&#10;Speaker 2: Thanks for having me."
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={5}
          />
        </div>

        <Button
          className="w-full"
          size="lg"
          disabled={!hasContent || loading}
          onClick={() =>
            onSubmit({
              audio: audioFile || undefined,
              transcript: transcriptFile || undefined,
              text: pastedText.trim() || undefined,
            })
          }
        >
          {loading ? 'Uploading...' : 'Upload & Analyze'}
        </Button>
      </CardContent>
    </Card>
  )
}
