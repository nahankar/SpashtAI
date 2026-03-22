import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ProcessingStatusProps {
  status: string
  errorMessage?: string | null
  onViewResults?: () => void
}

const STEPS = [
  { key: 'transcribing', label: 'Processing transcript', pct: 33 },
  { key: 'analyzing', label: 'Analyzing content with AI', pct: 66 },
  { key: 'completed', label: 'Analysis complete', pct: 100 },
]

export function ProcessingStatus({ status, errorMessage, onViewResults }: ProcessingStatusProps) {
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
