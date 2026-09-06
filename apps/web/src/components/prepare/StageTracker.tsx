import { Check, Circle, SkipForward } from 'lucide-react'
import type { PreparationStage } from '@/lib/prepare-types'
import { cn } from '@/lib/utils'

export function StageTracker({
  stages,
  compact = false,
}: {
  stages: PreparationStage[]
  compact?: boolean
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <ol className="flex min-w-max items-start gap-1" aria-label="Interview stages">
        {stages.map((stage, index) => {
          const complete = stage.status === 'COMPLETED'
          const skipped = stage.status === 'SKIPPED'
          const scheduled = stage.status === 'SCHEDULED'
          return (
            <li key={stage.id} className="flex items-center">
              <div
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                  complete && 'border-emerald-300 bg-emerald-50 text-emerald-800',
                  skipped && 'border-muted bg-muted/40 text-muted-foreground',
                  scheduled && 'border-primary/40 bg-primary/10 text-primary',
                )}
                title={`${stage.name}: ${stage.status.toLowerCase()}`}
              >
                {complete ? (
                  <Check className="h-3 w-3" aria-hidden />
                ) : skipped ? (
                  <SkipForward className="h-3 w-3" aria-hidden />
                ) : (
                  <Circle className="h-3 w-3" aria-hidden />
                )}
                <span className={cn(compact && 'max-w-24 truncate')}>{stage.name}</span>
                <span className="sr-only">— {stage.status.toLowerCase()}</span>
              </div>
              {index < stages.length - 1 && (
                <span className="mx-1 h-px w-4 bg-border" aria-hidden />
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
