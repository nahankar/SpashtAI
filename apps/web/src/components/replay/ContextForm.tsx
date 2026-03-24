import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const MEETING_TYPES = [
  'Job Interview',
  'Sales Call',
  'Team Meeting',
  'Client Presentation',
  'Conference Talk',
  'Other',
]

const ROLES = ['Interviewee', 'Interviewer', 'Presenter', 'Participant', 'Leader']

const FOCUS_AREAS = [
  'Speaking pace',
  'Confidence',
  'Clarity',
  'Filler words',
  'Technical accuracy',
  'Persuasiveness',
]

interface ContextFormProps {
  onSubmit: (data: {
    sessionName?: string
    meetingType: string
    userRole: string
    focusAreas: string[]
    meetingGoal?: string
    meetingDate?: string
    participantName?: string
  }) => void
  loading?: boolean
}

export function ContextForm({ onSubmit, loading }: ContextFormProps) {
  const [sessionName, setSessionName] = useState('')
  const [meetingType, setMeetingType] = useState('')
  const [userRole, setUserRole] = useState('')
  const [focusAreas, setFocusAreas] = useState<string[]>([])
  const [meetingGoal, setMeetingGoal] = useState('')
  const [meetingDate, setMeetingDate] = useState('')
  const [participantName, setParticipantName] = useState('')

  const toggleFocus = (area: string) => {
    setFocusAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    )
  }

  const canSubmit = sessionName.trim() && meetingType && userRole

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
          <Label htmlFor="meetingType">Meeting Type *</Label>
          <select
            id="meetingType"
            value={meetingType}
            onChange={(e) => setMeetingType(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Select meeting type...</option>
            {MEETING_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="userRole">Your Role *</Label>
          <select
            id="userRole"
            value={userRole}
            onChange={(e) => setUserRole(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Select your role...</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="participantName">Your Name in Transcript</Label>
          <input
            id="participantName"
            type="text"
            placeholder="e.g. Neelesh, Sarah, Speaker 1"
            value={participantName}
            onChange={(e) => setParticipantName(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Enter your name as it appears in the transcript so we can focus the analysis on you.
          </p>
        </div>

        <div className="grid gap-2">
          <Label>Focus Areas</Label>
          <div className="flex flex-wrap gap-2">
            {FOCUS_AREAS.map((area) => {
              const selected = focusAreas.includes(area)
              return (
                <button
                  key={area}
                  type="button"
                  onClick={() => toggleFocus(area)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {area}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="meetingGoal">Meeting Goal (optional)</Label>
          <Textarea
            id="meetingGoal"
            placeholder="e.g. Convince the client to renew their contract"
            value={meetingGoal}
            onChange={(e) => setMeetingGoal(e.target.value)}
            rows={2}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="meetingDate">Meeting Date (optional)</Label>
          <input
            id="meetingDate"
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <Button
          className="w-full"
          size="lg"
          disabled={!canSubmit || loading}
          onClick={() =>
            onSubmit({
              sessionName: sessionName.trim() || undefined,
              meetingType,
              userRole,
              focusAreas,
              meetingGoal: meetingGoal || undefined,
              meetingDate: meetingDate || undefined,
              participantName: participantName.trim() || undefined,
            })
          }
        >
          {loading ? 'Creating...' : 'Continue'}
        </Button>
      </CardContent>
    </Card>
  )
}
