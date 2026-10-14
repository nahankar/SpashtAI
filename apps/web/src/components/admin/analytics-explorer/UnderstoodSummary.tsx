import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { understandingChips } from './format'
import type { AnalyticsPlan } from './types'

export function UnderstoodSummary({ plan }: { plan: AnalyticsPlan }) {
  const chips = understandingChips(plan)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What I understood</CardTitle>
        <CardDescription>{plan.explanation}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {chips.map((chip, index) => (
          <Badge key={`${chip.label}-${index}`} variant={chip.tone}>
            {chip.label}
          </Badge>
        ))}
      </CardContent>
    </Card>
  )
}
