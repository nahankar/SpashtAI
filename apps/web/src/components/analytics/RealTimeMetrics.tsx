import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { MessageSquare, Clock, Gauge, Sparkles, Hash, Zap, Lightbulb } from 'lucide-react';
import type { LiveMetricsSnapshot } from '@/hooks/useSessionMetrics';

interface RealTimeMetricsProps {
  metrics: LiveMetricsSnapshot | null;
  isVisible?: boolean;
}

// Map pacing buckets to a (Tailwind) tone + display label. Kept here so the
// component stays a pure renderer — the agent owns the bucketing.
const PACING_TONE: Record<NonNullable<LiveMetricsSnapshot['pacingQualitative']>, { dot: string; text: string; label: string }> = {
  'not-enough-data': { dot: 'bg-zinc-400', text: 'text-zinc-500', label: 'Listening…' },
  slow: { dot: 'bg-yellow-500', text: 'text-yellow-600', label: 'Slow' },
  measured: { dot: 'bg-blue-500', text: 'text-blue-600', label: 'Measured' },
  ideal: { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Ideal' },
  fast: { dot: 'bg-orange-500', text: 'text-orange-600', label: 'Fast' },
  rapid: { dot: 'bg-red-500', text: 'text-red-600', label: 'Rapid' },
};

function formatSeconds(s: number | undefined): string {
  if (!s || s <= 0) return '0s';
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m ${r}s`;
}

function fillerTone(rate: number): string {
  if (rate <= 2) return 'text-emerald-600';
  if (rate <= 5) return 'text-blue-600';
  if (rate <= 8) return 'text-yellow-600';
  return 'text-red-600';
}

export function RealTimeMetrics({ metrics, isVisible = true }: RealTimeMetricsProps) {
  if (!isVisible) return null;

  // Render a placeholder card while we're waiting for the first snapshot,
  // so the user knows the toggle worked even if no metrics have arrived yet.
  if (!metrics) {
    return (
      <Card className="fixed top-20 right-4 w-80 z-50 bg-background/95 backdrop-blur-sm border shadow-lg">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Gauge className="h-4 w-4" />
            Live Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Waiting for the first measurement… speak for a few seconds.
        </CardContent>
      </Card>
    );
  }

  const tone = PACING_TONE[metrics.pacingQualitative ?? 'not-enough-data'] ?? PACING_TONE['not-enough-data'];
  const wpmShown = metrics.userWpm > 0 ? Math.round(metrics.userWpm) : null;
  const vocabPct = metrics.userVocabDiversity != null ? Math.round(metrics.userVocabDiversity * 100) : null;

  return (
    <Card className="fixed top-20 right-4 w-80 z-50 bg-background/95 backdrop-blur-sm border shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            Live Metrics
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
            <span className={tone.text}>{tone.label}</span>
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Hero stat: pacing */}
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Speaking pace</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {wpmShown != null ? 'ideal 120–160 WPM' : ''}
            </span>
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className={`text-2xl font-semibold ${tone.text}`}>
              {wpmShown != null ? wpmShown : '—'}
            </span>
            {wpmShown != null && <span className="text-xs text-muted-foreground pb-1">WPM</span>}
          </div>
        </div>

        {/* Secondary grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat
            icon={<MessageSquare className="h-3 w-3" />}
            label="Turns"
            value={String(metrics.totalTurns)}
          />
          <Stat
            icon={<Hash className="h-3 w-3" />}
            label="Words"
            value={String(metrics.userTotalWords ?? 0)}
          />
          <Stat
            icon={<Clock className="h-3 w-3" />}
            label="Speaking"
            value={formatSeconds(metrics.userSpeakingSeconds)}
          />
          <Stat
            icon={<Zap className="h-3 w-3" />}
            label="Response"
            value={`${metrics.responseTimeAvg.toFixed(1)}s`}
          />
        </div>

        {/* Filler + vocab */}
        <div className="space-y-2 border-t pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Filler rate</span>
            <div className="flex items-center gap-1.5">
              <span className={`text-sm font-semibold ${fillerTone(metrics.userFillerRate)}`}>
                {metrics.userFillerRate.toFixed(1)}%
              </span>
              {metrics.userFillerCount != null && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {metrics.userFillerCount}
                </Badge>
              )}
            </div>
          </div>
          {vocabPct != null && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Vocabulary
              </span>
              <span className="text-sm font-semibold">{vocabPct}%</span>
            </div>
          )}
        </div>

        {/* Coaching tip — agent-generated, always one short actionable line */}
        {metrics.coachingTip && (
          <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 p-2.5">
            <div className="flex items-start gap-2 text-xs">
              <Lightbulb className="h-3.5 w-3.5 mt-0.5 text-primary flex-shrink-0" />
              <span className="leading-snug">{metrics.coachingTip}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

export default RealTimeMetrics;
