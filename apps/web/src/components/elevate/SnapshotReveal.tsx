import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Lightbulb, Play, Target, TrendingUp, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getAuthHeaders } from '@/lib/api-client'
import { inferFocusArea, getFocusAreaLabel } from '@/lib/focus-areas'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface CoachingData {
  topStrength?: string
  primaryImprovement?: string
  actionableAdvice?: string
  overallNarrative?: string
  error?: string
}

interface SnapshotMessage {
  role: 'user' | 'assistant'
  content: string
}

function firstSentence(text: string, max = 180) {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  const match = trimmed.match(/^(.+?[.!?])(\s|$)/)
  const sentence = (match?.[1] || trimmed).trim()
  return sentence.length > max ? `${sentence.slice(0, max).trim()}…` : sentence
}

export function SnapshotReveal({
  sessionId,
  messages,
  onSeeFull,
  onPlayClip,
}: {
  sessionId: string
  messages: SnapshotMessage[]
  onSeeFull: () => void
  onPlayClip: () => void
}) {
  const [coaching, setCoaching] = useState<CoachingData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let attempts = 0

    async function load() {
      try {
        const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/coaching-insights`, {
          headers: getAuthHeaders(),
        })
        if (!res.ok) return false
        const data = (await res.json()) as CoachingData
        if (cancelled) return false
        setCoaching(data)
        return Boolean(
          data &&
            !data.error &&
            (data.topStrength || data.primaryImprovement || data.overallNarrative),
        )
      } catch {
        return false
      }
    }

    setLoading(true)
    load().then((ready) => {
      if (cancelled) return
      setLoading(false)
      if (ready) return
      const timer = setInterval(async () => {
        attempts += 1
        const readyNow = await load()
        if (cancelled || readyNow || attempts >= 8) {
          clearInterval(timer)
          if (!cancelled) setLoading(false)
        }
      }, 2500)
    })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  const clip = useMemo(() => {
    const userTurns = messages
      .filter((message) => message.role === 'user' && message.content.trim())
      .map((message) => message.content.trim())
    if (userTurns.length === 0) return null
    return [...userTurns].reverse().find((text) => text.split(/\s+/).length >= 12) || userTurns[userTurns.length - 1]
  }, [messages])

  const strength = coaching?.topStrength?.trim() || null
  const improvement = (coaching?.primaryImprovement || coaching?.actionableAdvice || '').trim() || null
  const headline =
    firstSentence(coaching?.overallNarrative || '') ||
    (strength && improvement
      ? `${firstSentence(strength)} ${firstSentence(improvement)}`
      : 'Here is your communication snapshot.')
  const practiceFocus = inferFocusArea(improvement || strength || 'clarity')

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Communication snapshot
        </p>
        <p className="text-lg font-semibold leading-snug">{headline}</p>
      </div>

      {loading && !strength && !improvement && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing your three takeaways…
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <TrendingUp className="h-4 w-4 text-green-600" />
              Strength
            </div>
            <p className="text-sm text-muted-foreground">
              {strength || 'Your snapshot is saved. Strength will appear once insights finish.'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Target className="h-4 w-4 text-amber-600" />
              One improvement
            </div>
            <p className="text-sm text-muted-foreground">
              {improvement || 'Your next focus will appear once insights finish.'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lightbulb className="h-4 w-4 text-primary" />
              Your clip
            </div>
            <p className="text-sm text-muted-foreground line-clamp-5">
              {clip ? `“${clip}”` : 'No spoken clip was saved for this snapshot.'}
            </p>
            {clip && (
              <Button size="sm" variant="outline" onClick={onPlayClip}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Hear this
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild className="sm:flex-1">
          <Link to={`/elevate?focus=${encodeURIComponent(practiceFocus)}&newSession=true`}>
            Practice {getFocusAreaLabel(practiceFocus)}
          </Link>
        </Button>
        <Button variant="outline" className="sm:flex-1" onClick={onSeeFull}>
          See full session
        </Button>
      </div>
    </div>
  )
}
