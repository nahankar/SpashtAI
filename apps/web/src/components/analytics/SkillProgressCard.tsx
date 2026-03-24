import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'
import { getFocusAreaLabel } from '@/lib/focus-areas'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface SkillSummaryItem {
  skill: string
  currentScore: number
  previousScore: number | null
  delta: number | null
  totalSessions: number
}

function scoreColor(score: number): string {
  if (score >= 8) return 'text-green-600'
  if (score >= 5) return 'text-amber-600'
  return 'text-red-500'
}

function scoreBg(score: number): string {
  if (score >= 8) return 'bg-green-500'
  if (score >= 5) return 'bg-amber-500'
  return 'bg-red-500'
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return null
  if (Math.abs(delta) < 0.1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> Steady
      </span>
    )
  }
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-green-600">
        <TrendingUp className="h-3 w-3" /> +{delta.toFixed(1)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-red-500">
      <TrendingDown className="h-3 w-3" /> {delta.toFixed(1)}
    </span>
  )
}

export function SkillProgressCard() {
  const [summary, setSummary] = useState<SkillSummaryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/skill-progress/summary`, {
          headers: getAuthHeaders(),
        })
        if (res.ok) {
          const data = await res.json()
          setSummary(data.summary || [])
        }
      } catch {
        // non-critical
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading skill progress...
        </CardContent>
      </Card>
    )
  }

  if (summary.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Skill Progress</CardTitle>
          <CardDescription>
            Complete a Replay analysis or Elevate session to start tracking your skills.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-4 text-center text-sm text-muted-foreground">
          No data yet — your progress will appear here after your first session.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Skill Progress</CardTitle>
        <CardDescription>
          Your latest scores across {summary.length} skill{summary.length !== 1 ? 's' : ''} from Replay &amp; Elevate sessions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summary.map((item) => (
            <div
              key={item.skill}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <div className="flex flex-col items-center">
                <span className={`text-lg font-bold ${scoreColor(item.currentScore)}`}>
                  {item.currentScore.toFixed(1)}
                </span>
                <div className="mt-1 h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${scoreBg(item.currentScore)}`}
                    style={{ width: `${item.currentScore * 10}%` }}
                  />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{getFocusAreaLabel(item.skill)}</p>
                <div className="flex items-center gap-2">
                  <DeltaBadge delta={item.delta} />
                  <span className="text-xs text-muted-foreground">
                    {item.totalSessions} session{item.totalSessions !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
