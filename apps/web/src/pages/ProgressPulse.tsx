import { ProgressPulseCard } from '@/components/analytics/ProgressPulseCard'
import { useFeatureFlags } from '@/contexts/FeatureFlagsContext'

export function ProgressPulse() {
  const { isEnabled } = useFeatureFlags()
  const sources = [
    isEnabled('replay') ? 'Replay analyses' : null,
    isEnabled('elevate') ? 'Elevate practice sessions' : null,
  ].filter(Boolean)

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Progress Pulse</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {sources.length > 0
            ? `Track your communication skills across ${sources.join(' and ')}.`
            : 'Progress tracking will appear when coaching modules are enabled.'}
        </p>
      </div>
      <ProgressPulseCard />
    </div>
  )
}
