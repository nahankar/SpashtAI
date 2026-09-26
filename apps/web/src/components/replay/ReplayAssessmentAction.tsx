import { Button } from '@/components/ui/button'
import type { ReplayEvidence } from './evidence-contract'

export function ReplayAssessmentAction({ evidence, hasAssessment, busy, onAnalyze }: {
  evidence: Pick<ReplayEvidence, 'identity'>
  hasAssessment: boolean
  busy: boolean
  onAnalyze: () => void
}) {
  if (evidence.identity.state !== 'confirmed' || hasAssessment) return null
  return <section aria-label="Personal assessment" className="my-4 rounded-lg border p-4 space-y-2">
    <p>Your speaker is confirmed. Analyze this speaker to generate personal content coaching and skill scores.</p>
    <p className="text-sm text-muted-foreground">Valid saved transcription is reused. This does not infer vocal personality or emotion.</p>
    <Button onClick={onAnalyze} disabled={busy}>Analyze my speech</Button>
  </section>
}
