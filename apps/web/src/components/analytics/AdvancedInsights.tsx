import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { 
  Brain, 
  MessageSquare, 
  AlertCircle,
  BarChart3,
  Activity
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
import { getAuthHeaders } from '@/lib/api-client';
import { hasRealProsody, isUsableProsody } from '@/lib/prosody';

/**
 * V2 analytics shapes (from /communication-signals, /skill-scores,
 * /coaching-insights). The legacy agent-side content/delivery/insights blobs
 * were frequently empty (missing spaCy model / no persisted audio in dev), so
 * we now derive this view from the server-side v2 engine instead.
 */
interface V2Signals {
  speechRate?: { wpm?: number; variability?: number; totalWords?: number }
  fillers?: { count?: number; rate?: number }
  hedging?: { count?: number; rate?: number }
  sentenceComplexity?: { avgLength?: number; subordinateRatio?: number; readability?: number }
  vocabDiversity?: { ratio?: number; uniqueWords?: number; totalWords?: number; sophistication?: number }
  prosody?: {
    pitchVariation?: number
    energyStability?: number
    voiceQuality?: number
    pauseCount?: number
    meanPauseDuration?: number
    raw?: {
      pitchStdHz?: number
      pitchMeanHz?: number
      intensityStdDb?: number
      hnrDb?: number
    }
  } | null
}
interface V2SkillScores {
  scores?: Record<string, number | null>
}
interface V2Coaching {
  topStrength?: string
  primaryImprovement?: string
  actionableAdvice?: string
  practiceExercise?: string
  overallNarrative?: string
  error?: string
}

/** Map the deterministic v2 signals + LLM coaching into this card's shape. */
function buildFromV2(
  signals: V2Signals | null,
  _skill: V2SkillScores | null,
  coaching: V2Coaching | null,
  advanced: AdvancedMetrics | null,
): AdvancedMetrics {
  const s = signals ?? {}
  const vocab = s.vocabDiversity ?? {}
  const sc = s.sentenceComplexity ?? {}
  const sr = s.speechRate ?? {}
  const fl = s.fillers ?? {}

  // Derive sentence/complexity counts from the v2 signals instead of hardcoding
  // zeros: the engine reports avg sentence length + subordinate-clause ratio, so
  // sentences ≈ words / avgLength and complex ≈ subordinateRatio × sentences.
  const totalW = vocab.totalWords ?? 0
  const avgLen = sc.avgLength ?? 0
  const subRatio = sc.subordinateRatio ?? 0
  const sentenceCount = avgLen > 0 ? Math.round(totalW / avgLen) : 0
  const complexSentences = Math.round(subRatio * sentenceCount)

  const content_metrics: AdvancedMetrics['content_metrics'] = signals
    ? {
        vocabulary: {
          total_words: totalW,
          unique_words: vocab.uniqueWords ?? 0,
          diversity_ratio: vocab.ratio ?? 0,
          sophistication_score: vocab.sophistication ?? 0,
          domain_relevance: 0,
          academic_words: 0,
          business_terms: 0,
        },
        grammar: {
          sentence_count: sentenceCount,
          avg_sentence_length: avgLen,
          complex_sentences: complexSentences,
          simple_sentences: Math.max(sentenceCount - complexSentences, 0),
          readability_score: sc.readability ?? 0,
          syntactic_complexity: subRatio * 10,
        },
        entities: { companies: [], roles: [], skills: [], technologies: [] },
        confidence_language: 0,
        relevance_score: 0,
      }
    : undefined

  const prosody = s.prosody ?? null
  const alignedDelivery = advanced?.delivery_metrics
  const hasAcousticProsody = isUsableProsody(prosody)
  const delivery_metrics: AdvancedMetrics['delivery_metrics'] = signals
    ? {
        speech_rate: sr.wpm ?? 0,
        articulation_rate: alignedDelivery?.articulation_rate ?? 0,
        pause_count: alignedDelivery?.pause_count ?? (hasAcousticProsody ? (prosody?.pauseCount ?? 0) : 0),
        mean_pause_duration:
          alignedDelivery?.mean_pause_duration ??
          (hasAcousticProsody ? (prosody?.meanPauseDuration ?? 0) : 0),
        filler_word_count: fl.count ?? 0,
        filler_word_rate: (fl.rate ?? 0) * 100,
        pitch_variation: hasAcousticProsody ? (prosody?.pitchVariation ?? 0) : 0,
        energy_stability: hasAcousticProsody ? (prosody?.energyStability ?? 0) : 0,
        voice_quality_score: hasAcousticProsody ? (prosody?.voiceQuality ?? 0) : 0,
        delivery_evidence:
          alignedDelivery?.delivery_evidence ??
          (prosody?.raw
            ? {
                schema_version: 1,
                status: 'experimental' as const,
                calibration_status: 'uncalibrated' as const,
                acoustic: {
                  source: 'praat',
                  raw_measurements: {
                    mean_f0_hz: prosody.raw.pitchMeanHz,
                    f0_std_hz: prosody.raw.pitchStdHz,
                    // The signal API exposes dispersion, not the agent's
                    // inverse-stability index. Do not relabel it.
                    intensity_stability_inverse_std: null,
                    harmonicity_mean_db: prosody.raw.hnrDb,
                  },
                },
              }
            : undefined),
      }
    : undefined

  // Insights tab: strengths / improvements / recommendations from the LLM
  // coaching. The headline skill scores live in SkillScoresCard, so we skip the
  // big overall-score card here to avoid a duplicate (overall_score undefined).
  const performance_insights: AdvancedMetrics['performance_insights'] = coaching
    ? {
        strengths: coaching.topStrength ? [coaching.topStrength] : [],
        areas_for_improvement: coaching.primaryImprovement ? [coaching.primaryImprovement] : [],
        recommendations: [
          coaching.actionableAdvice,
          coaching.practiceExercise,
          coaching.overallNarrative,
        ].filter((x): x is string => Boolean(x)),
      }
    : undefined

  return {
    content_processed: Boolean(signals),
    audio_processed: hasAcousticProsody,
    insights_generated: Boolean(coaching),
    content_metrics,
    delivery_metrics,
    performance_insights,
  }
}

interface AdvancedInsightsProps {
  sessionId: string;
  isSessionEnded?: boolean;
}

interface AdvancedMetrics {
  content_processed: boolean;
  audio_processed: boolean;
  insights_generated: boolean;
  
  content_metrics?: {
    vocabulary: {
      total_words: number;
      unique_words: number;
      diversity_ratio: number;
      sophistication_score: number;
      domain_relevance: number;
      academic_words: number;
      business_terms: number;
    };
    grammar: {
      sentence_count: number;
      avg_sentence_length: number;
      complex_sentences: number;
      simple_sentences: number;
      readability_score: number;
      syntactic_complexity: number;
    };
    entities: {
      companies: string[];
      roles: string[];
      skills: string[];
      technologies: string[];
    };
    confidence_language: number;
    relevance_score: number;
  };
  
  delivery_metrics?: {
    speech_rate: number;
    articulation_rate: number;
    pause_count: number;
    mean_pause_duration: number;
    filler_word_count: number;
    filler_word_rate: number;
    pitch_variation: number;
    energy_stability: number;
    voice_quality_score: number;
    delivery_evidence?: {
      schema_version?: number;
      status?: 'experimental' | 'insufficient_evidence';
      calibration_status?: 'uncalibrated' | 'calibrated';
      timing?: {
        source?: string;
        transcript_coverage?: number;
        aligned_word_count?: number;
      };
      acoustic?: {
        source?: string;
        raw_measurements?: {
          mean_f0_hz?: number | null;
          f0_std_hz?: number | null;
          intensity_stability_inverse_std?: number | null;
          harmonicity_mean_db?: number | null;
        };
      };
    };
  };
  
  performance_insights?: {
    overall_score?: number;
    category_scores?: {
      content_quality: number;
      delivery_effectiveness: number;
      communication_clarity: number;
    };
    strengths: string[];
    areas_for_improvement: string[];
    recommendations: string[];
  };
  
  processing_errors?: string[];
}

// ── Plain-language verdicts ────────────────────────────────────────────
// Each metric gets a "good / ok / needs work" rating plus a one-line tip so the
// user knows whether a number is good and how to improve it.
type Tone = 'good' | 'ok' | 'bad'

const TONE_STYLES: Record<Tone, { badge: string; label: string }> = {
  good: { badge: 'bg-green-100 text-green-700 border-green-200', label: 'Good' },
  ok: { badge: 'bg-amber-100 text-amber-700 border-amber-200', label: 'OK' },
  bad: { badge: 'bg-red-100 text-red-700 border-red-200', label: 'Needs work' },
}

export interface MetricVerdict {
  tone: Tone
  tip: string
}

function Verdict({ verdict }: { verdict: MetricVerdict | null }) {
  if (!verdict) return null
  const s = TONE_STYLES[verdict.tone]
  return (
    <div className="mt-1.5">
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.badge}`}>
        {s.label}
      </span>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{verdict.tip}</p>
    </div>
  )
}

// Shared with report rendering; colocated with the component to keep verdict copy consistent.
// eslint-disable-next-line react-refresh/only-export-components
export const DELIVERY_VERDICTS: Record<string, (v: number) => MetricVerdict> = {
  speechRate: (wpm) =>
    wpm >= 120 && wpm <= 180
      ? { tone: 'good', tip: 'Comfortable, easy-to-follow pace.' }
      : wpm >= 80 && wpm <= 220
        ? { tone: 'ok', tip: wpm < 120 ? 'A touch slow — lift the pace on simpler points.' : 'A touch fast — add pauses so ideas land.' }
        : { tone: 'bad', tip: wpm < 80 ? 'Too slow; aim for ~140 WPM.' : 'Too fast; slow to ~150 WPM and breathe.' },
  fillerRate: (rate) =>
    rate < 2
      ? { tone: 'good', tip: 'Clean, polished delivery.' }
      : rate <= 5
        ? { tone: 'ok', tip: 'Some fillers — pause silently instead of saying "um".' }
        : { tone: 'bad', tip: 'Frequent fillers weaken your message. Replace them with short pauses.' },
  pitchVariation: (v) =>
    v >= 5
      ? { tone: 'good', tip: 'Expressive, engaging intonation.' }
      : v >= 3
        ? { tone: 'ok', tip: 'A little flat — vary pitch to stress key words.' }
        : { tone: 'bad', tip: 'Monotone delivery — lift and drop your pitch on important points.' },
  energyStability: (v) =>
    v >= 6
      ? { tone: 'good', tip: 'Steady, controlled volume.' }
      : v >= 4
        ? { tone: 'ok', tip: 'Volume wavers a bit — keep your energy consistent.' }
        : { tone: 'bad', tip: 'Uneven volume — project consistently so you stay easy to hear.' },
  voiceQuality: (v) =>
    v >= 6
      ? { tone: 'good', tip: 'Recording signal shows higher harmonic clarity.' }
      : v >= 4
        ? { tone: 'ok', tip: 'Recording signal shows moderate harmonic clarity.' }
        : { tone: 'bad', tip: 'Recording signal suggests lower harmonic clarity; microphone and room conditions can affect this.' },
}

// Shared with report rendering; colocated with the component to keep verdict copy consistent.
// eslint-disable-next-line react-refresh/only-export-components
export const CONTENT_VERDICTS: Record<string, (v: number) => MetricVerdict> = {
  diversity: (pct) =>
    pct > 30
      ? { tone: 'good', tip: 'Varied, engaging word choices.' }
      : pct >= 20
        ? { tone: 'ok', tip: 'Some repetition — try varying your phrasing.' }
        : { tone: 'bad', tip: 'Limited range — prepare varied phrases for key points.' },
  sophistication: (v) =>
    v >= 6
      ? { tone: 'good', tip: 'Rich, precise vocabulary.' }
      : v >= 4
        ? { tone: 'ok', tip: 'Moderate — add a few more precise terms where they help.' }
        : { tone: 'bad', tip: 'Mostly basic words — swap in more specific vocabulary.' },
  avgSentenceLength: (len) =>
    len >= 12 && len <= 20
      ? { tone: 'good', tip: 'Clear, digestible sentence length.' }
      : len >= 8 && len <= 25
        ? { tone: 'ok', tip: len < 12 ? 'Sentences run short — combine related ideas.' : 'Sentences run long — tighten toward ~15 words.' }
        : { tone: 'bad', tip: 'Aim for ~15 words per sentence for clarity.' },
  syntacticComplexity: (v) =>
    v >= 3 && v <= 7
      ? { tone: 'good', tip: 'Good mix of simple and complex sentences.' }
      : v < 3
        ? { tone: 'ok', tip: 'Mostly simple sentences — combine ideas for flow.' }
        : { tone: 'bad', tip: 'Very complex — break long sentences into shorter ones.' },
}

export function AdvancedInsights({ sessionId, isSessionEnded = false }: AdvancedInsightsProps) {
  const [metrics, setMetrics] = useState<AdvancedMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAdvancedMetrics = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const [signalsRes, scoresRes, coachingRes, advancedRes] = await Promise.all([
        fetch(`${API_BASE_URL}/sessions/${sessionId}/communication-signals`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/skill-scores`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/coaching-insights`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/advanced-metrics`, { headers: getAuthHeaders() }),
      ]);

      const signals = signalsRes.ok ? ((await signalsRes.json()) as V2Signals) : null;
      const skill = scoresRes.ok ? ((await scoresRes.json()) as V2SkillScores) : null;
      const coaching = coachingRes.ok ? ((await coachingRes.json()) as V2Coaching) : null;
      const advanced = advancedRes.ok ? ((await advancedRes.json()) as AdvancedMetrics) : null;

      if (!signals && !skill && !coaching) {
        if (!opts?.silent) {
          setError('Advanced analysis not available yet');
          setMetrics(null);
        }
        return false;
      }

      setMetrics(buildFromV2(signals, skill, coaching, advanced));
      return hasRealProsody(signals);
    } catch (err) {
      console.error('Error fetching advanced metrics:', err);
      if (!opts?.silent) {
        setError(err instanceof Error ? err.message : 'Failed to load advanced insights');
      }
      return false;
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!isSessionEnded || !sessionId) return
    let cancelled = false
    let hasProsody = false
    void fetchAdvancedMetrics().then((found) => {
      if (!cancelled) hasProsody = Boolean(found)
    })
    const started = Date.now()
    const poll = window.setInterval(() => {
      if (cancelled || hasProsody || document.visibilityState === 'hidden') return
      if (Date.now() - started > 60_000) {
        window.clearInterval(poll)
        return
      }
      void fetchAdvancedMetrics({ silent: true }).then((found) => {
        if (found) hasProsody = true
      })
    }, 4000)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !hasProsody) {
        void fetchAdvancedMetrics({ silent: true })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sessionId, isSessionEnded, fetchAdvancedMetrics])

  if (!isSessionEnded) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Advanced Analytics
          </CardTitle>
          <CardDescription>
            Deep insights will be available after the session ends
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <div className="text-center text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Session in progress...</p>
            <p className="text-sm mt-1">Analytics processing will begin when you disconnect</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 animate-pulse" />
            Processing Advanced Analytics...
          </CardTitle>
          <CardDescription>
            Analyzing content with spaCy, audio with Praat, and generating insights
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-3"></div>
            <p className="text-muted-foreground">Processing deep analytics...</p>
            <p className="text-sm text-muted-foreground mt-1">This may take 10-30 seconds</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !metrics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            Advanced Analytics
          </CardTitle>
          <CardDescription>
            {error || 'No advanced insights available yet'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <button 
            onClick={() => void fetchAdvancedMetrics()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Retry Loading
          </button>
        </CardContent>
      </Card>
    );
  }

  const c = metrics.content_metrics
  const d = metrics.delivery_metrics
  const hasProsody = Boolean(metrics.audio_processed)
  const rawAcoustics = d?.delivery_evidence?.acoustic?.raw_measurements
  const rawMeasurement = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  const hasRawAcoustics = Boolean(
    rawMeasurement(rawAcoustics?.f0_std_hz) != null ||
      rawMeasurement(rawAcoustics?.harmonicity_mean_db) != null ||
      rawMeasurement(rawAcoustics?.mean_f0_hz) != null,
  )
  const diversityPct = c ? c.vocabulary.diversity_ratio * 100 : 0

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Brain className="h-5 w-5" />
          Communication Analysis
        </h3>
        <p className="text-sm text-muted-foreground">
          What you said (Content) and how you said it (Delivery), with whether each signal is on
          track and how to improve it.
        </p>
      </div>

      {/* Content & Delivery side by side — no tab switching. items-stretch makes
          both columns equal height; the last card in each column grows (flex-1)
          so the Grammar and Voice Quality cards line up at the bottom. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
        {/* ── Content ───────────────────────────────────────────── */}
        <div className="flex h-full flex-col gap-4">
          {c ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MessageSquare className="h-5 w-5" />
                    Content — Vocabulary
                  </CardTitle>
                  <CardDescription>What you said and how varied your wording was</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Total Words</div>
                      <div className="text-2xl font-bold">{c.vocabulary.total_words}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Unique Words</div>
                      <div className="text-2xl font-bold">{c.vocabulary.unique_words}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Diversity</div>
                      <div className="text-2xl font-bold">{diversityPct.toFixed(1)}%</div>
                      <Progress value={diversityPct} className="mt-1" />
                      <Verdict verdict={CONTENT_VERDICTS.diversity(diversityPct)} />
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Sophistication</div>
                      <div className="text-2xl font-bold">{c.vocabulary.sophistication_score.toFixed(1)}/10</div>
                      <Progress value={c.vocabulary.sophistication_score * 10} className="mt-1" />
                      <Verdict verdict={CONTENT_VERDICTS.sophistication(c.vocabulary.sophistication_score)} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="flex flex-1 flex-col">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BarChart3 className="h-5 w-5" />
                    Content — Grammar & Structure
                  </CardTitle>
                  <CardDescription>How your sentences are built</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Sentences</div>
                      <div className="text-2xl font-bold">{c.grammar.sentence_count}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Avg Length</div>
                      <div className="text-2xl font-bold">{c.grammar.avg_sentence_length.toFixed(1)} words</div>
                      <Verdict verdict={CONTENT_VERDICTS.avgSentenceLength(c.grammar.avg_sentence_length)} />
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Complex Sentences</div>
                      <div className="text-2xl font-bold">{c.grammar.complex_sentences}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Syntactic Complexity</div>
                      <div className="text-2xl font-bold">{c.grammar.syntactic_complexity.toFixed(1)}/10</div>
                      <Progress value={c.grammar.syntactic_complexity * 10} className="mt-1" />
                      <Verdict verdict={CONTENT_VERDICTS.syntacticComplexity(c.grammar.syntactic_complexity)} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {c.entities &&
                ((c.entities.skills || []).length > 0 || (c.entities.technologies || []).length > 0) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Entities Mentioned</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Accordion type="single" collapsible>
                        {(c.entities.skills || []).length > 0 && (
                          <AccordionItem value="skills">
                            <AccordionTrigger>Skills ({(c.entities.skills || []).length})</AccordionTrigger>
                            <AccordionContent>
                              <div className="flex flex-wrap gap-2">
                                {(c.entities.skills || []).map((skill, idx) => (
                                  <Badge key={idx} variant="outline">{skill}</Badge>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        )}
                        {(c.entities.technologies || []).length > 0 && (
                          <AccordionItem value="tech">
                            <AccordionTrigger>Technologies ({(c.entities.technologies || []).length})</AccordionTrigger>
                            <AccordionContent>
                              <div className="flex flex-wrap gap-2">
                                {(c.entities.technologies || []).map((tech, idx) => (
                                  <Badge key={idx} variant="outline">{tech}</Badge>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        )}
                      </Accordion>
                    </CardContent>
                  </Card>
                )}
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Content analysis not available yet. Reprocess the session to generate vocabulary and
                grammar insights.
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Delivery ──────────────────────────────────────────────
            Pace & fillers live in Speaking Performance (the single source of
            truth), so Delivery only shows what's unique to the recording: the
            acoustic prosody (voice quality, pitch, energy) and pauses. */}
        <div className="flex h-full flex-col gap-4">
          {hasProsody && d ? (
            <Card className="flex flex-1 flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-5 w-5" />
                  Delivery — Acoustic measurements
                </CardTitle>
                <CardDescription>
                  Experimental acoustic indices — sensitive to microphone and browser processing
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-4">
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
                  These are experimental recording indices, not a judgment of your voice, confidence, or vocal health.
                  Coaching labels will appear only after calibration against reviewed recordings.
                </p>
                {hasRawAcoustics ? (
                  <div className="grid gap-2 border-y py-3 text-sm sm:grid-cols-2">
                    {rawMeasurement(rawAcoustics?.f0_std_hz) != null && (
                      <div>
                        <div className="text-muted-foreground">Pitch spread</div>
                        <div className="font-semibold">{rawMeasurement(rawAcoustics?.f0_std_hz)!.toFixed(1)} Hz</div>
                      </div>
                    )}
                    {rawMeasurement(rawAcoustics?.mean_f0_hz) != null && (
                      <div>
                        <div className="text-muted-foreground">Mean fundamental frequency</div>
                        <div className="font-semibold">{rawMeasurement(rawAcoustics?.mean_f0_hz)!.toFixed(1)} Hz</div>
                      </div>
                    )}
                    {rawMeasurement(rawAcoustics?.harmonicity_mean_db) != null && (
                      <div>
                        <div className="text-muted-foreground">Harmonicity</div>
                        <div className="font-semibold">{rawMeasurement(rawAcoustics?.harmonicity_mean_db)!.toFixed(1)} dB</div>
                      </div>
                    )}
                    {rawMeasurement(rawAcoustics?.intensity_stability_inverse_std) != null && (
                      <div>
                        <div className="text-muted-foreground">Intensity stability index</div>
                        <div className="font-semibold">{rawMeasurement(rawAcoustics?.intensity_stability_inverse_std)!.toFixed(2)}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                    Experimental recording indices are available, but this older analysis did not preserve the raw units needed for a trustworthy display.
                  </p>
                )}

                {d.articulation_rate > 0 && (
                  <div className="border-t pt-3">
                    <div className="text-sm text-muted-foreground">Articulation rate</div>
                    <div className="text-2xl font-bold">
                      {Math.round(d.articulation_rate)} <span className="text-sm font-normal">WPM</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Voiced-word time only; pauses are excluded.
                    </div>
                  </div>
                )}

                {d.pause_count > 0 && (
                  <div className="border-t pt-3">
                    <div className="text-sm text-muted-foreground">Pauses</div>
                    <div className="text-2xl font-bold">{d.pause_count}</div>
                    <div className="text-xs text-muted-foreground">Avg: {d.mean_pause_duration.toFixed(2)}s</div>
                  </div>
                )}

                {/* Raw-measurement methodology, deliberately separate from future calibrated coaching. */}
                <p className="border-t pt-3 text-[11px] leading-snug text-muted-foreground">
                  <span className="font-medium text-foreground">How these are measured:</span> a
                  Praat acoustic analysis of your recording. Pitch observations use fundamental frequency in Hz;
                  harmonicity is shown in dB. Recorded level may be flattened by automatic gain control.
                  These observations are not a diagnosis of vocal strain. <span className="font-medium">Pauses</span> are
                  detected within-utterance silent intervals; long inter-turn gaps are excluded.
                  Delivery pace, which includes meaningful pauses, is in <span className="font-medium">Speaking Performance</span> above.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="flex flex-1 flex-col border-dashed">
              <CardContent className="flex flex-1 flex-col items-center justify-center py-6 text-center text-sm text-muted-foreground">
                <Activity className="mb-2 h-6 w-6 opacity-50" />
                Delivery voice quality (pitch variation, energy stability, voice quality, pauses) comes
                from an acoustic analysis of your recording, which isn&apos;t available for this session
                yet. Pace &amp; fillers are shown in Speaking Performance above.
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {metrics.processing_errors && metrics.processing_errors.length > 0 && (
        <Card className="border-muted">
          <CardContent className="pt-6">
            <div className="text-xs text-yellow-600">
              <AlertCircle className="h-3 w-3 inline mr-1" />
              Some processing warnings occurred
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default AdvancedInsights;
