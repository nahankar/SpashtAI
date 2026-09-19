import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  CalendarClock,
  FileSearch,
  Loader2,
  MessageCircleMore,
  Mic,
  RotateCcw,
  Send,
  Target,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { pulseSkillLabel } from '@/lib/pulse-skills'
import {
  getCoachHome,
  type CoachHomeRecommendation,
} from '@/lib/coach-api'

function primaryLabel(recommendation: CoachHomeRecommendation): string {
  switch (recommendation.kind) {
    case 'result':
      return recommendation.module === 'replay' ? 'Review analysis' : 'Review practice'
    case 'live-resume':
      return 'Resume now'
    case 'resume':
      return 'Resume coaching'
    case 'prepare':
      return `Practise your ${recommendation.stageName} round`
    case 'pulse':
      return recommendation.practiceAvailable
        ? `Practise ${pulseSkillLabel(recommendation.skill).toLowerCase()} in Elevate`
        : 'View Progress Pulse'
    case 'onboarding':
      return 'Ask Coach'
  }
}

function RecommendationIcon({
  recommendation,
}: {
  recommendation: CoachHomeRecommendation
}) {
  const Icon =
    recommendation.kind === 'result'
      ? FileSearch
      : recommendation.kind === 'resume' || recommendation.kind === 'live-resume'
        ? RotateCcw
        : recommendation.kind === 'prepare'
          ? CalendarClock
          : recommendation.kind === 'pulse'
            ? Target
            : MessageCircleMore
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
      <Icon className="h-5 w-5" />
    </div>
  )
}

export function CoachHome({
  onPrimary,
  onSecondary,
  onAsk,
}: {
  onPrimary: (recommendation: CoachHomeRecommendation) => void | Promise<void>
  onSecondary: (recommendation: CoachHomeRecommendation) => void | Promise<void>
  onAsk: (message: string) => void | Promise<void>
}) {
  const [recommendation, setRecommendation] = useState<CoachHomeRecommendation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [starting, setStarting] = useState(false)
  const [opening, setOpening] = useState(false)

  const loadHome = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getCoachHome()
      .then((response) => {
        if (!cancelled) setRecommendation(response.recommendation)
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Coach Home could not load')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => loadHome(), [loadHome])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const message = draft.trim()
    if (!message || starting) return
    setStarting(true)
    try {
      await onAsk(message)
      setDraft('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Coach could not start this conversation')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-[760px] space-y-8 px-4 py-8 sm:px-6 sm:py-12"
      aria-busy={loading || starting || opening}
    >
      {loading && (
        <div
          className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Choosing your next step…
        </div>
      )}

      {!loading && error && !recommendation && (
        <Card className="shadow-none">
          <CardContent className="space-y-4 py-6 text-sm text-muted-foreground">
            <p role="alert">{error}</p>
            <Button type="button" size="sm" variant="outline" onClick={loadHome}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && recommendation && (
        <Card className="overflow-hidden shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-4">
              <RecommendationIcon recommendation={recommendation} />
              <div className="min-w-0 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {recommendation.kind === 'result'
                    ? 'Recent outcome'
                    : recommendation.kind === 'live-resume'
                      ? 'Interrupted session'
                    : recommendation.kind === 'resume'
                      ? 'Continue where you left off'
                      : recommendation.kind === 'onboarding'
                        ? 'Start with context'
                        : 'Recommended next step'}
                </p>
                <CardTitle className="text-xl leading-snug">{recommendation.title}</CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <p className="text-sm leading-relaxed text-muted-foreground">
              {recommendation.kind === 'resume'
                ? `Coach needs one detail: ${recommendation.question}`
                : recommendation.reason}
            </p>
            {recommendation.kind === 'result' && recommendation.insight && (
              <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
                {recommendation.insight}
              </p>
            )}
            {recommendation.kind === 'prepare' && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" />
                {new Date(recommendation.scheduledAt).toLocaleString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            )}
            {recommendation.kind !== 'onboarding' && (
              <div className="flex flex-wrap items-center gap-4">
                <Button
                  type="button"
                  size="sm"
                  className="gap-2"
                  disabled={opening}
                  onClick={() => {
                    setError(null)
                    setOpening(true)
                    void Promise.resolve(onPrimary(recommendation))
                      .catch((reason) =>
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : 'Coach could not open this recommendation',
                        ),
                      )
                      .finally(() => setOpening(false))
                  }}
                >
                  {opening ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : recommendation.kind === 'prepare' ||
                    (recommendation.kind === 'pulse' && recommendation.practiceAvailable) ? (
                    <Mic className="h-4 w-4" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                  {primaryLabel(recommendation)}
                </Button>
                {(recommendation.kind === 'prepare' ||
                  (recommendation.kind === 'pulse' && recommendation.practiceAvailable)) && (
                  <Button
                    type="button"
                    disabled={opening}
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-muted-foreground"
                    onClick={() => {
                      setError(null)
                      setOpening(true)
                      void Promise.resolve(onSecondary(recommendation))
                        .catch((reason) =>
                          setError(
                            reason instanceof Error
                              ? reason.message
                              : 'Coach could not open this recommendation',
                          ),
                        )
                        .finally(() => setOpening(false))
                    }}
                  >
                    {recommendation.kind === 'prepare' ? 'Open journey' : 'View Progress Pulse'}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && (
        <section className="space-y-3">
          {recommendation?.kind !== 'onboarding' && (
            <p className="text-sm font-medium">Want to work on something else?</p>
          )}
          <form onSubmit={submit} className="relative">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={500}
              placeholder="Ask Coach…"
              className="h-12 rounded-xl pr-12"
              aria-label="Ask Coach"
            />
            <Button
              type="submit"
              size="icon"
              className="absolute right-1.5 top-1.5 h-9 w-9 rounded-lg"
              disabled={!draft.trim() || starting}
              aria-label="Start coaching"
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
          {recommendation?.kind === 'onboarding' && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Try: “I have an interview next week” · “Help me pitch an idea” · “I want to
              reduce filler words”
            </p>
          )}
        </section>
      )}
    </div>
  )
}
