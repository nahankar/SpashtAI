import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Lightbulb, Target, TrendingUp, Zap, Activity, Loader2 } from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface CoachingData {
  topStrength?: string
  primaryImprovement?: string
  actionableAdvice?: string
  practiceExercise?: string
  overallNarrative?: string
  error?: string
}

interface CoachingInsightsCardProps {
  sessionId: string
  isSessionEnded?: boolean
  /** Stretch the card to fill its column (used in the side-by-side layout). */
  fill?: boolean
  initialCoaching?: CoachingData | null
}

/**
 * Standalone coaching insights. Previously this lived inside SkillScoresCard and
 * was also duplicated as the "Insights" tab in AdvancedInsights. It's now a
 * single source of truth so it can sit beside Speaking Performance.
 */
export function CoachingInsightsCard({
  sessionId,
  isSessionEnded = true,
  fill = false,
  initialCoaching,
}: CoachingInsightsCardProps) {
  const [coaching, setCoaching] = useState<CoachingData | null>(initialCoaching ?? null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (initialCoaching) setCoaching(initialCoaching)
  }, [initialCoaching])

  useEffect(() => {
    if (!isSessionEnded || !sessionId || initialCoaching) return
    let cancelled = false
    setLoading(true)
    fetch(`${API_BASE_URL}/sessions/${sessionId}/coaching-insights`, { headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setCoaching(data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, isSessionEnded, initialCoaching])

  if (!isSessionEnded) return null

  const hasContent =
    coaching &&
    !coaching.error &&
    (coaching.topStrength ||
      coaching.primaryImprovement ||
      coaching.actionableAdvice ||
      coaching.practiceExercise ||
      coaching.overallNarrative)

  return (
    <Card className={fill ? 'h-full' : ''}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-blue-600" />
          Coaching Insights
        </CardTitle>
        {coaching?.overallNarrative && (
          <CardDescription className="text-sm leading-relaxed">
            {coaching.overallNarrative}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !coaching && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Generating coaching feedback…
          </div>
        )}

        {!loading && !hasContent && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Coaching insights aren&apos;t available for this session yet.
          </p>
        )}

        {coaching?.topStrength && (
          <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
            <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
            <div>
              <p className="text-sm font-medium text-green-800">Top Strength</p>
              <p className="mt-0.5 text-sm text-green-700">{coaching.topStrength}</p>
            </div>
          </div>
        )}

        {coaching?.primaryImprovement && (
          <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
            <Target className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600" />
            <div>
              <p className="text-sm font-medium text-yellow-800">Focus Area</p>
              <p className="mt-0.5 text-sm text-yellow-700">{coaching.primaryImprovement}</p>
            </div>
          </div>
        )}

        {coaching?.actionableAdvice && (
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Zap className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">Actionable Advice</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{coaching.actionableAdvice}</p>
            </div>
          </div>
        )}

        {coaching?.practiceExercise && (
          <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <Activity className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
            <div>
              <p className="text-sm font-medium text-blue-800">Practice Exercise</p>
              <p className="mt-0.5 text-sm text-blue-700">{coaching.practiceExercise}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default CoachingInsightsCard
