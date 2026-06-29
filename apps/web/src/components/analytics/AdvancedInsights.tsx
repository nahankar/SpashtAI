import { useEffect, useState } from 'react';
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
  skill: V2SkillScores | null,
  coaching: V2Coaching | null,
): AdvancedMetrics {
  const s = signals ?? {}
  const vocab = s.vocabDiversity ?? {}
  const sc = s.sentenceComplexity ?? {}
  const sr = s.speechRate ?? {}
  const fl = s.fillers ?? {}
  const scores = skill?.scores ?? {}

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

  const deliveryScore = (scores.delivery ?? null) as number | null
  const prosody = s.prosody ?? null
  const delivery_metrics: AdvancedMetrics['delivery_metrics'] = signals
    ? {
        speech_rate: sr.wpm ?? 0,
        articulation_rate: sr.wpm ?? 0,
        pause_count: prosody?.pauseCount ?? 0,
        mean_pause_duration: prosody?.meanPauseDuration ?? 0,
        filler_word_count: fl.count ?? 0,
        filler_word_rate: (fl.rate ?? 0) * 100,
        pitch_variation: prosody?.pitchVariation ?? 0,
        energy_stability: prosody?.energyStability ?? 0,
        voice_quality_score: prosody?.voiceQuality ?? deliveryScore ?? 0,
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
    audio_processed: deliveryScore != null,
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
      ? { tone: 'good', tip: 'Clear, resonant voice.' }
      : v >= 4
        ? { tone: 'ok', tip: 'Slightly strained or breathy — relax and breathe from the diaphragm.' }
        : { tone: 'bad', tip: 'Strained voice — warm up, hydrate, and slow down.' },
}

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

  useEffect(() => {
    if (isSessionEnded && sessionId) {
      fetchAdvancedMetrics();
    }
  }, [sessionId, isSessionEnded]);

  const fetchAdvancedMetrics = async () => {
    setLoading(true);
    setError(null);

    try {
      const [signalsRes, scoresRes, coachingRes] = await Promise.all([
        fetch(`${API_BASE_URL}/sessions/${sessionId}/communication-signals`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/skill-scores`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/coaching-insights`, { headers: getAuthHeaders() }),
      ]);

      const signals = signalsRes.ok ? ((await signalsRes.json()) as V2Signals) : null;
      const skill = scoresRes.ok ? ((await scoresRes.json()) as V2SkillScores) : null;
      const coaching = coachingRes.ok ? ((await coachingRes.json()) as V2Coaching) : null;

      if (!signals && !skill && !coaching) {
        setError('Advanced analysis not available yet');
        setMetrics(null);
        return;
      }

      setMetrics(buildFromV2(signals, skill, coaching));
    } catch (err) {
      console.error('Error fetching advanced metrics:', err);
      setError(err instanceof Error ? err.message : 'Failed to load advanced insights');
    } finally {
      setLoading(false);
    }
  };

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
            onClick={fetchAdvancedMetrics}
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
  const hasProsody =
    !!d && (d.voice_quality_score > 0 || d.pitch_variation > 0 || d.energy_stability > 0)
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
                  Delivery — Voice Quality
                </CardTitle>
                <CardDescription>How you sounded — acoustic analysis of your recording</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-4">
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>Voice Quality</span>
                    <Badge>{d.voice_quality_score.toFixed(1)}/10</Badge>
                  </div>
                  <Progress value={d.voice_quality_score * 10} />
                  <Verdict verdict={DELIVERY_VERDICTS.voiceQuality(d.voice_quality_score)} />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>Pitch Variation</span>
                    <Badge>{d.pitch_variation.toFixed(1)}/10</Badge>
                  </div>
                  <Progress value={d.pitch_variation * 10} />
                  <Verdict verdict={DELIVERY_VERDICTS.pitchVariation(d.pitch_variation)} />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>Energy Stability</span>
                    <Badge>{d.energy_stability.toFixed(1)}/10</Badge>
                  </div>
                  <Progress value={d.energy_stability * 10} />
                  <Verdict verdict={DELIVERY_VERDICTS.energyStability(d.energy_stability)} />
                </div>

                {d.pause_count > 0 && (
                  <div className="border-t pt-3">
                    <div className="text-sm text-muted-foreground">Pauses</div>
                    <div className="text-2xl font-bold">{d.pause_count}</div>
                    <div className="text-xs text-muted-foreground">Avg: {d.mean_pause_duration.toFixed(2)}s</div>
                  </div>
                )}

                {/* How these acoustic scores are computed — answers "how is pitch rated?" */}
                <p className="border-t pt-3 text-[11px] leading-snug text-muted-foreground">
                  <span className="font-medium text-foreground">How these are rated (0–10):</span> a
                  Praat acoustic analysis of your recording. <span className="font-medium">Pitch
                  Variation</span> reflects how much your pitch moves (spread of fundamental frequency
                  in semitones) — flat/monotone scores low, expressive scores high. <span className="font-medium">Energy
                  Stability</span> is how consistent your volume is, and <span className="font-medium">Voice
                  Quality</span> is the harmonics-to-noise ratio (clarity vs. breathiness/strain).
                  Pace &amp; fillers are in <span className="font-medium">Speaking Performance</span> above.
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
