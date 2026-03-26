import { useState, useRef, type DragEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Upload, X, FileAudio, FileText, Film } from 'lucide-react'

const AUDIO_TYPES = ['.mp3', '.mp4', '.wav', '.m4a', '.ogg', '.mov', '.webm']
const TEXT_TYPES = ['.txt', '.json', '.srt', '.vtt']
const ALL_ACCEPT = [...AUDIO_TYPES, ...TEXT_TYPES].join(',')

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
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null)
  const [pastedText, setPastedText] = useState('')
  const [dragging, setDragging] = useState(false)
  const audioRef = useRef<HTMLInputElement>(null)
  const transcriptRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    for (const f of files) {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase()
      if (AUDIO_TYPES.includes(ext)) {
        setAudioFile(f)
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
          manually (needed for My Progress Pulse trends).
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
            Audio: MP3, MP4, WAV, M4A, OGG, MOV, WebM (max 500MB)
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
              Choose Audio/Video
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
            accept={AUDIO_TYPES.join(',')}
            className="hidden"
            onChange={(e) => e.target.files?.[0] && setAudioFile(e.target.files[0])}
          />
          <input
            ref={transcriptRef}
            type="file"
            accept={TEXT_TYPES.join(',')}
            className="hidden"
            onChange={(e) => e.target.files?.[0] && setTranscriptFile(e.target.files[0])}
          />
        </div>

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
