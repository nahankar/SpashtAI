import { Button } from '@/components/ui/button'
import type { ReplayEvidence } from './evidence-contract'

export function ReplayAssessmentAction({ evidence, hasAssessment, busy, onAnalyze }: {
  evidence: Pick<ReplayEvidence, 'identity'> & Partial<Pick<ReplayEvidence, 'speakers' | 'assessmentGate'>>
  hasAssessment: boolean
  busy: boolean
  onAnalyze: () => void
}) {
  if (hasAssessment) return null
  if (evidence.identity.state !== 'confirmed') {
    return <section aria-label="Personal assessment" className="my-4 rounded-lg border p-4 space-y-2">
      <p className="font-medium">Confirm your speaker to generate personalized AI Insights.</p>
      <p className="text-sm text-muted-foreground">No learner-specific scoring or coaching is generated until speaker confirmation.</p>
    </section>
  }
  const selected = evidence.speakers?.find(item => item.speaker === evidence.identity.speaker)
  if (evidence.assessmentGate === 'insufficient_speech' || selected?.assessmentEligible === false) {
    return <section aria-label="Personal assessment" className="my-4 rounded-lg border p-4 space-y-2">
      <p className="font-medium">There is not enough of this speaker’s speech to score communication or generate coaching.</p>
      <p className="text-sm text-muted-foreground">Confirming a speaker does not create a full assessment from one short utterance.</p>
    </section>
  }
  return <section aria-label="Personal assessment" className="my-4 rounded-lg border p-4 space-y-2">
    <p className="font-medium">Ready to analyze your selected speech.</p>
    <p className="text-sm text-muted-foreground">Valid saved transcription is reused. This does not infer vocal personality or emotion.</p>
    <Button onClick={onAnalyze} disabled={busy}>Analyze my speech</Button>
  </section>
}
