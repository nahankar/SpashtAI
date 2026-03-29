import { ProgressPulseCard } from '@/components/analytics/ProgressPulseCard'

export function ProgressPulse() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">My Progress Pulse</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track your communication skills across Replay analyses and Elevate practice sessions.
        </p>
      </div>
      <ProgressPulseCard />
    </div>
  )
}
