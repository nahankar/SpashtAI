import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Loader2, CheckCircle2, XCircle, AlertTriangle, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ParticipantMismatch } from '@/hooks/useReplaySession'

interface ProcessingStatusProps {
  status: string
  errorMessage?: string | null
  participantMismatch?: ParticipantMismatch | null
  onViewResults?: () => void
  onSelectSpeaker?: (speaker: string) => void
  loading?: boolean
}

const STEPS = [
  { key: 'transcribing', label: 'Processing transcript', pct: 33 },
  { key: 'analyzing', label: 'Analyzing content with AI', pct: 66 },
  { key: 'completed', label: 'Analysis complete', pct: 100 },
]

export function ProcessingStatus({
  status,
  errorMessage,
  participantMismatch,
  onViewResults,
  onSelectSpeaker,
  loading,
}: ProcessingStatusProps) {
  // Speaker mismatch takes priority over generic failure display
  if (participantMismatch && onSelectSpeaker) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Participant Not Found
          </CardTitle>
          <CardDescription>
            "{participantMismatch.participantName}" was not found in the transcript.
            Please select which speaker you are.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            We detected {participantMismatch.detectedSpeakers.length} speaker{participantMismatch.detectedSpeakers.length !== 1 ? 's' : ''} in your transcript:
          </p>
          <div className="grid gap-2">
            {participantMismatch.detectedSpeakers.map((speaker) => (
              <button
                key={speaker}
                disabled={loading}
                onClick={() => onSelectSpeaker(speaker)}
                className="flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-50"
              >
                <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                {speaker}
              </button>
            ))}
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Re-processing with selected speaker...
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  const currentStep = STEPS.find((s) => s.key === status)
  const pct = status === 'failed' ? 0 : (currentStep?.pct ?? 10)
  const isFailed = status === 'failed'
  const isComplete = status === 'completed'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isFailed && <XCircle className="h-5 w-5 text-destructive" />}
          {isComplete && <CheckCircle2 className="h-5 w-5 text-green-500" />}
          {!isFailed && !isComplete && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
          {isFailed ? 'Processing Failed' : isComplete ? 'Analysis Complete' : 'Processing...'}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!isFailed && <Progress value={pct} className="h-2" />}

        <div className="grid gap-2">
          {STEPS.map((step) => {
            const isDone = pct > step.pct || (pct === step.pct && isComplete)
            const isActive = step.key === status && !isComplete
            return (
              <div
                key={step.key}
                className={`flex items-center gap-2 text-sm ${
                  isDone
                    ? 'text-green-600'
                    : isActive
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                }`}
              >
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : isActive ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <div className="h-4 w-4 rounded-full border" />
                )}
                {step.label}
              </div>
            )
          })}
        </div>

        {isFailed && errorMessage && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        {isComplete && onViewResults && (
          <Button className="w-full" size="lg" onClick={onViewResults}>
            View Results
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
