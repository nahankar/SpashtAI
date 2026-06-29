import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { LogoWithBeta } from '@/components/brand/LogoWithBeta'
import {
  Upload,
  Mic,
  TrendingUp,
  Pause,
  BarChart3,
  Gauge,
  Sparkles,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  MessageSquare,
  Target,
  Clock,
} from 'lucide-react'

/* ─────────────────────────── Dummy visual glimpses ─────────────────────────── */

function SkillBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value * 10}%` }} />
      </div>
    </div>
  )
}

/** Replay — Session Analytics card glimpse. */
function ReplayGlimpse() {
  return (
    <Card className="w-full overflow-hidden border-primary/20 shadow-xl">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Session Analytics</span>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md border border-green-300 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
            <CheckCircle2 className="h-3 w-3" /> Tracked in Pulse
          </span>
        </div>

        <div className="flex items-end gap-3 rounded-lg bg-muted/40 p-4">
          <div className="text-4xl font-bold leading-none text-primary">8.4</div>
          <div className="pb-1 text-xs text-muted-foreground">
            Communication
            <br />
            Score / 10
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <SkillBar label="Clarity" value={8.1} />
          <SkillBar label="Confidence" value={7.6} />
          <SkillBar label="Engagement" value={8.8} />
          <SkillBar label="Structure" value={7.2} />
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { k: 'WPM', v: '123', note: 'ideal' },
            { k: 'Filler', v: '0.4%', note: 'low' },
            { k: 'Hedging', v: '2', note: 'good' },
          ].map((m) => (
            <div key={m.k} className="rounded-md border bg-card p-2">
              <div className="text-sm font-bold">{m.v}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.k}</div>
              <div className="text-[10px] font-medium text-green-600">{m.note}</div>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">AI insight:</span> Strong, engaging open.
            Tighten the mid-section — two sentences ran long and diluted your key point.
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

/** Elevate — live playback + metrics strip glimpse. */
function ElevateGlimpse() {
  // Quality-segmented seek bar (green = great, amber = ok, red = needs work)
  const segments = [
    'bg-emerald-400',
    'bg-emerald-400',
    'bg-amber-400',
    'bg-emerald-400',
    'bg-emerald-400',
    'bg-red-400',
    'bg-amber-400',
    'bg-emerald-400',
  ]
  return (
    <Card className="w-full overflow-hidden border-primary/20 shadow-xl">
      <CardContent className="space-y-4 p-5">
        {/* Metrics strip — mirrors the live "Show metrics" panel */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1">
            <Gauge className="h-3.5 w-3.5 text-primary" />
            <span className="text-muted-foreground">Score</span>
            <span className="font-bold text-primary">8.4</span>
          </span>
          <span className="h-3 w-px bg-border" />
          <span className="inline-flex items-center gap-1">
            <span className="text-muted-foreground">Filler</span>
            <span className="font-bold text-green-600">0.4%</span>
          </span>
          <span className="h-3 w-px bg-border" />
          <span className="inline-flex items-center gap-1">
            <span className="text-muted-foreground">Pace</span>
            <svg width="56" height="18" viewBox="0 0 56 18" className="text-emerald-500">
              <polyline
                points="0,12 10,9 18,13 26,6 34,8 44,4 56,7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="h-3 w-px bg-border" />
          <span className="inline-flex items-center gap-1">
            <span className="text-muted-foreground">WPM</span>
            <span className="font-bold">123</span>
          </span>
        </div>

        {/* Karaoke caption */}
        <div className="rounded-lg border bg-card p-3 text-sm leading-relaxed">
          <span className="text-muted-foreground">So the way I&apos;d </span>
          <span className="rounded bg-primary/15 px-0.5 font-medium text-foreground">
            approach this is to start with the customer&apos;s core problem
          </span>
          <span className="text-muted-foreground"> and work backwards from there.</span>
        </div>

        {/* Playback timeline with quality segments */}
        <div className="space-y-2">
          <div className="flex gap-0.5">
            {segments.map((c, i) => (
              <div key={i} className={`h-2 flex-1 rounded-full ${c}`} />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Pause className="h-4 w-4" />
              </span>
              <span className="text-xs text-muted-foreground">0:17 / 2:48</span>
            </div>
            <Badge variant="secondary" className="text-[10px]">
              <Mic className="mr-1 h-3 w-3" /> Live AI coach
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** Progress Pulse — cross-session trend glimpse. */
function ProgressPulseGlimpse() {
  const rows = [
    { label: 'Clarity', score: 7.8, delta: +0.6 },
    { label: 'Confidence', score: 7.1, delta: +0.4 },
    { label: 'Conciseness', score: 6.4, delta: -0.2 },
    { label: 'Engagement', score: 8.2, delta: +0.9 },
  ]
  return (
    <Card className="w-full overflow-hidden border-primary/20 shadow-xl">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Progress Pulse</span>
          </div>
          <span className="text-xs text-muted-foreground">last 6 sessions</span>
        </div>

        {/* Sparkline */}
        <div className="rounded-lg bg-muted/40 p-3">
          <svg width="100%" height="56" viewBox="0 0 240 56" preserveAspectRatio="none">
            <polyline
              points="0,44 40,40 80,34 120,30 160,20 200,16 240,8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
            />
          </svg>
          <div className="mt-1 text-center text-xs text-muted-foreground">
            Overall communication score trending up
          </div>
        </div>

        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="flex items-center gap-2">
                <span className="font-semibold">{r.score.toFixed(1)}</span>
                <span
                  className={`inline-flex items-center gap-0.5 text-xs font-medium ${
                    r.delta >= 0 ? 'text-green-600' : 'text-red-500'
                  }`}
                >
                  <ArrowUpRight className={`h-3 w-3 ${r.delta < 0 ? 'rotate-90' : ''}`} />
                  {r.delta >= 0 ? '+' : ''}
                  {r.delta.toFixed(1)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/* ─────────────────────────── Feature section ─────────────────────────── */

interface FeatureSectionProps {
  eyebrow: string
  icon: typeof Mic
  title: string
  description: string
  bullets: string[]
  glimpse: ReactNode
  reverse?: boolean
}

function FeatureSection({
  eyebrow,
  icon: Icon,
  title,
  description,
  bullets,
  glimpse,
  reverse,
}: FeatureSectionProps) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
      <div className={reverse ? 'lg:order-2' : ''}>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
          <Icon className="h-3.5 w-3.5" /> {eyebrow}
        </div>
        <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h3>
        <p className="mt-3 text-muted-foreground">{description}</p>
        <ul className="mt-5 space-y-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={reverse ? 'lg:order-1' : ''}>{glimpse}</div>
    </div>
  )
}

/* ─────────────────────────── Landing page ─────────────────────────── */

export function Landing() {
  const { loginWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  async function handleGoogleCredential(credential: string) {
    const user = await loginWithGoogle(credential)
    navigate(user.needsProfileCompletion ? '/auth/complete-profile' : '/')
  }

  return (
    <div className="bg-background">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:items-center">
          <div>
            <Badge variant="secondary" className="mb-4">
              <Sparkles className="mr-1 h-3 w-3" /> AI communication coach
            </Badge>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Master every <span className="text-primary">conversation</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">
              Practice live with an AI coach, replay and analyze real meetings, and watch your
              communication skills compound over time — all in one place.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button size="lg" onClick={() => navigate('/auth/register')}>
                Get started free <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate('/auth/login')}>
                Sign in
              </Button>
            </div>

            <div className="mt-6 max-w-xs">
              {error && (
                <div className="mb-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  {error}
                </div>
              )}
              <GoogleSignInButton
                label="signup_with"
                onCredential={handleGoogleCredential}
                onError={setError}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Free to start. No credit card required.
              </p>
            </div>
          </div>

          {/* Hero glimpse stack */}
          <div className="relative">
            <div className="absolute -right-4 top-8 hidden w-64 rotate-3 sm:block">
              <ProgressPulseGlimpse />
            </div>
            <div className="relative z-10 w-full max-w-md">
              <ElevateGlimpse />
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature trio ── */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Three ways to level up</h2>
          <p className="mt-2 text-muted-foreground">
            One platform covering the full loop — practice, analyze, and track progress.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            {
              icon: Upload,
              name: 'Replay',
              blurb:
                'Upload a recording or transcript and get an instant, detailed breakdown of how you communicated.',
            },
            {
              icon: Mic,
              name: 'Elevate',
              blurb:
                'Practice live with a real-time AI coach, then play back the session with karaoke-synced feedback.',
            },
            {
              icon: TrendingUp,
              name: 'Progress Pulse',
              blurb:
                'Every session feeds your trend lines so you can see exactly where you’re improving.',
            },
          ].map((f) => (
            <Card key={f.name} className="border-muted transition-all hover:border-primary/40 hover:shadow-md">
              <CardContent className="p-6">
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold">{f.name}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.blurb}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Detailed feature sections ── */}
      <section className="mx-auto max-w-6xl space-y-20 px-4 py-10 sm:px-6">
        <FeatureSection
          eyebrow="Replay"
          icon={Upload}
          title="Turn any meeting into a coaching session"
          description="Drop in an audio, video, or transcript file. SpashtAI analyzes delivery, structure, and content, then shows you exactly what worked and what to fix — with the receipts."
          bullets={[
            'Communication score with a per-skill breakdown',
            'Delivery metrics: pace, fillers, hedging, vocabulary',
            'AI insights tied to the exact moments they happened',
            'Export a polished PDF report to share',
          ]}
          glimpse={<ReplayGlimpse />}
        />

        <FeatureSection
          eyebrow="Elevate"
          icon={Mic}
          title="Practice live, then replay the evidence"
          description="Rehearse interviews, pitches, and tough conversations with a responsive AI coach. Live metrics guide you in the moment, and karaoke-synced playback lets you relive every turn."
          bullets={[
            'Real-time pace, filler, and confidence signals',
            'Quality-segmented playback timeline',
            'Word-synced transcript to hear the exact moment',
            'Key moments and AI phrasing suggestions',
          ]}
          glimpse={<ElevateGlimpse />}
          reverse
        />

        <FeatureSection
          eyebrow="Progress Pulse"
          icon={TrendingUp}
          title="Watch your skills compound"
          description="Every Replay and Elevate session feeds a single, honest view of your growth. See which skills are climbing, which need attention, and get targeted practice recommendations."
          bullets={[
            'Cross-session trends for every communication skill',
            'Session-over-session deltas, no guesswork',
            'Recommended next practice based on your weak spots',
            'Stays in sync across Replay and Elevate',
          ]}
          glimpse={<ProgressPulseGlimpse />}
        />
      </section>

      {/* ── Stats / trust strip ── */}
      <section className="border-y bg-muted/30">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 sm:px-6 md:grid-cols-4">
          {[
            { icon: Gauge, label: '6-layer metrics', sub: 'delivery to content' },
            { icon: Clock, label: 'Instant analysis', sub: 'results in seconds' },
            { icon: MessageSquare, label: 'Word-level feedback', sub: 'tied to real moments' },
            { icon: Target, label: 'Personalized', sub: 'practice that adapts' },
          ].map((s) => (
            <div key={s.label} className="flex items-start gap-3">
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <s.icon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <Card className="overflow-hidden border-primary/20">
          <CardContent className="relative flex flex-col items-center gap-5 p-10 text-center">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent" />
            <div className="relative">
              <LogoWithBeta imgClassName="h-12 w-auto" />
            </div>
            <h2 className="relative text-2xl font-bold tracking-tight sm:text-3xl">
              Start improving your communication
            </h2>
            <p className="relative max-w-xl text-muted-foreground">
              Create a free account and run your first session in minutes.
            </p>
            <div className="relative flex flex-col gap-3 sm:flex-row">
              <Button size="lg" onClick={() => navigate('/auth/register')}>
                Sign up free <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/auth/login">Sign in</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
