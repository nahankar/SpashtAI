import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

interface ContextFormProps {
  onSubmit: (data: {
    sessionName?: string
    meetingDate?: string
    participantName: string
  }) => void
  loading?: boolean
}

export function ContextForm({ onSubmit, loading }: ContextFormProps) {
  const [sessionName, setSessionName] = useState('')
  const [meetingDate, setMeetingDate] = useState('')
  const [participantName, setParticipantName] = useState('')

  const canSubmit = sessionName.trim() && participantName.trim()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meeting Context</CardTitle>
        <CardDescription>
          Tell us about the meeting so we can provide relevant feedback.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="sessionName">Session Name *</Label>
          <input
            id="sessionName"
            type="text"
            placeholder="e.g. Q1 Client Review, Interview with Acme Corp"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Give this session a memorable name so you can find it later.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="participantName">Your Name in Transcript *</Label>
          <input
            id="participantName"
            type="text"
            placeholder="e.g. Neelesh, Sarah, Speaker 1"
            value={participantName}
            onChange={(e) => setParticipantName(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Enter your name exactly as it appears in the transcript. If this name is not found during analysis,
            SpashtAI automatically falls back to the dominant speaker.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="meetingDate">Meeting date (optional here)</Label>
          <input
            id="meetingDate"
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            If you upload a VTT, we try to read the calendar date from the file name (e.g. Zoom{' '}
            <span className="font-mono">GMT20240315-…</span>) or from a line in the header — not from subtitle
            timestamps. If we cannot detect it, you will be asked for the date before analysis so{' '}
            <strong>My Progress Pulse</strong> trends stay in real chronological order.
          </p>
        </div>

        <Button
          className="w-full"
          size="lg"
          disabled={!canSubmit || loading}
          onClick={() =>
            onSubmit({
              sessionName: sessionName.trim() || undefined,
              meetingDate: meetingDate.trim() || undefined,
              participantName: participantName.trim(),
            })
          }
        >
          {loading ? 'Creating...' : 'Continue'}
        </Button>
      </CardContent>
    </Card>
  )
}
