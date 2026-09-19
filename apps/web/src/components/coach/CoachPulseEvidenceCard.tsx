import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { pulseSkillLabel } from '@/lib/pulse-skills'
import type { CoachPulseEvidence } from '@/lib/coach-api'

function trendLabel(skill: CoachPulseEvidence['skills'][number]): string {
  if (skill.trend === 'latest') return 'Latest'
  if (skill.trend === 'up') return `↑ ${Math.abs(skill.delta ?? 0).toFixed(1)}`
  if (skill.trend === 'down') return `↓ ${Math.abs(skill.delta ?? 0).toFixed(1)}`
  return '→'
}

export function CoachPulseEvidenceCard({
  evidence,
  primary,
  threadId,
  showPulseLink = true,
}: {
  evidence: CoachPulseEvidence
  primary?: { label: string; to: string; onClick?: () => void }
  threadId?: string
  showPulseLink?: boolean
}) {
  const measurementLabel =
    evidence.measurementCount === 1 ? 'tracked measurement' : 'tracked measurements'

  return (
    <Card className="max-w-[min(100%,28rem)] shadow-none">
      <CardContent className="space-y-4 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Your current Pulse
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {evidence.measurementCount} {measurementLabel} · last {evidence.windowDays} days
          </p>
        </div>
        <ul className="space-y-2">
          {evidence.skills.map((skill) => {
            const isFocus = evidence.opportunity?.skill === skill.skill
            return (
              <li
                key={skill.skill}
                className="grid grid-cols-[minmax(0,1fr)_auto_minmax(5.5rem,auto)] items-baseline gap-3 text-sm"
              >
                <span className="truncate font-medium">{pulseSkillLabel(skill.skill)}</span>
                <span className="tabular-nums text-muted-foreground">
                  {skill.score.toFixed(1)}
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {trendLabel(skill)}
                  {isFocus ? (
                    <span className="ml-2 font-medium text-foreground">Focus next</span>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          {primary && (
            <Button asChild size="sm">
              <Link to={primary.to} onClick={primary.onClick}>
                {primary.label}
              </Link>
            </Button>
          )}
          {showPulseLink && (
            <Button asChild variant="link" size="sm" className="h-auto p-0 text-muted-foreground">
              <Link
                to={
                  threadId
                    ? `/progress?coach=1&thread=${encodeURIComponent(threadId)}`
                    : '/progress'
                }
              >
                View full Progress Pulse
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
