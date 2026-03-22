import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { 
  Brain, 
  Mic, 
  MessageSquare, 
  TrendingUp, 
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  Award,
  Target,
  Lightbulb,
  BarChart3,
  Activity
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { getAuthHeaders } from '@/lib/api-client';

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
    overall_score: number;
    category_scores: {
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
      const response = await fetch(`http://localhost:4000/sessions/${sessionId}/advanced-metrics`, {
        headers: getAuthHeaders(),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }
      
      const data = await response.json();
      setMetrics(data);
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

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-blue-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBadge = (score: number) => {
    if (score >= 80) return 'default';
    if (score >= 60) return 'secondary';
    return 'destructive';
  };

  return (
    <div className="space-y-6">
      {/* Overall Performance Score */}
      {metrics.performance_insights && metrics.performance_insights.overall_score !== undefined && (
        <Card className="border-2 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-6 w-6 text-yellow-600" />
              Overall Performance Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <div className="text-center flex-1">
                <div className={`text-6xl font-bold ${getScoreColor(metrics.performance_insights.overall_score)}`}>
                  {metrics.performance_insights.overall_score.toFixed(0)}
                </div>
                <div className="text-muted-foreground mt-1">out of 100</div>
              </div>
              <div className="flex-1 space-y-3">
                {metrics.performance_insights.category_scores && (
                  <>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Content Quality</span>
                        <Badge variant={getScoreBadge(metrics.performance_insights.category_scores.content_quality || 0)}>
                          {(metrics.performance_insights.category_scores.content_quality || 0).toFixed(0)}
                        </Badge>
                      </div>
                      <Progress value={metrics.performance_insights.category_scores.content_quality || 0} />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Delivery Effectiveness</span>
                        <Badge variant={getScoreBadge(metrics.performance_insights.category_scores.delivery_effectiveness || 0)}>
                          {(metrics.performance_insights.category_scores.delivery_effectiveness || 0).toFixed(0)}
                        </Badge>
                      </div>
                      <Progress value={metrics.performance_insights.category_scores.delivery_effectiveness || 0} />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Communication Clarity</span>
                        <Badge variant={getScoreBadge(metrics.performance_insights.category_scores.communication_clarity || 0)}>
                          {(metrics.performance_insights.category_scores.communication_clarity || 0).toFixed(0)}
                        </Badge>
                      </div>
                      <Progress value={metrics.performance_insights.category_scores.communication_clarity || 0} />
                    </div>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="insights" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="insights">
            <Lightbulb className="h-4 w-4 mr-2" />
            Insights
          </TabsTrigger>
          <TabsTrigger value="content">
            <Brain className="h-4 w-4 mr-2" />
            Content
          </TabsTrigger>
          <TabsTrigger value="delivery">
            <Mic className="h-4 w-4 mr-2" />
            Delivery
          </TabsTrigger>
        </TabsList>

        {/* Insights Tab */}
        <TabsContent value="insights" className="space-y-4">
          {metrics.performance_insights && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    Strengths
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {(metrics.performance_insights.strengths || []).map((strength, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <TrendingUp className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span className="text-sm">{strength}</span>
                      </li>
                    ))}
                    {(!metrics.performance_insights.strengths || metrics.performance_insights.strengths.length === 0) && (
                      <li className="text-sm text-muted-foreground">No strengths identified yet</li>
                    )}
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-yellow-600" />
                    Areas for Improvement
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {(metrics.performance_insights.areas_for_improvement || []).map((area, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <TrendingDown className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                        <span className="text-sm">{area}</span>
                      </li>
                    ))}
                    {(!metrics.performance_insights.areas_for_improvement || metrics.performance_insights.areas_for_improvement.length === 0) && (
                      <li className="text-sm text-muted-foreground">No areas for improvement identified</li>
                    )}
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-blue-600" />
                    Recommendations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {(metrics.performance_insights.recommendations || []).map((rec, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-blue-600 font-bold mt-0.5 flex-shrink-0">{idx + 1}.</span>
                        <span className="text-sm">{rec}</span>
                      </li>
                    ))}
                    {(!metrics.performance_insights.recommendations || metrics.performance_insights.recommendations.length === 0) && (
                      <li className="text-sm text-muted-foreground">No recommendations available</li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Content Analysis Tab */}
        <TabsContent value="content" className="space-y-4">
          {metrics.content_metrics && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5" />
                    Vocabulary Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Total Words</div>
                      <div className="text-2xl font-bold">{metrics.content_metrics.vocabulary.total_words}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Unique Words</div>
                      <div className="text-2xl font-bold">{metrics.content_metrics.vocabulary.unique_words}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Diversity</div>
                      <div className="text-2xl font-bold">{(metrics.content_metrics.vocabulary.diversity_ratio * 100).toFixed(1)}%</div>
                      <Progress value={metrics.content_metrics.vocabulary.diversity_ratio * 100} className="mt-1" />
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Sophistication</div>
                      <div className="text-2xl font-bold">{metrics.content_metrics.vocabulary.sophistication_score.toFixed(1)}/10</div>
                      <Progress value={metrics.content_metrics.vocabulary.sophistication_score * 10} className="mt-1" />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                    <div>
                      <div className="text-sm text-muted-foreground">Academic Words</div>
                      <div className="text-lg font-semibold">{metrics.content_metrics.vocabulary.academic_words}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Business Terms</div>
                      <div className="text-lg font-semibold">{metrics.content_metrics.vocabulary.business_terms}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Grammar & Structure
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Sentences</div>
                      <div className="text-2xl font-bold">{metrics.content_metrics.grammar.sentence_count}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Avg Length</div>
                      <div className="text-2xl font-bold">{metrics.content_metrics.grammar.avg_sentence_length.toFixed(1)} words</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Complex Sentences</div>
                      <div className="text-2xl font-bold">{metrics.content_metrics.grammar.complex_sentences}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Syntactic Complexity</div>
                      <div className="text-2xl font-bold">{metrics.content_metrics.grammar.syntactic_complexity.toFixed(1)}/10</div>
                      <Progress value={metrics.content_metrics.grammar.syntactic_complexity * 10} className="mt-1" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {metrics.content_metrics.entities && (
                <Card>
                  <CardHeader>
                    <CardTitle>Entities Mentioned</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Accordion type="single" collapsible>
                      {(metrics.content_metrics.entities.skills || []).length > 0 && (
                        <AccordionItem value="skills">
                          <AccordionTrigger>Skills ({(metrics.content_metrics.entities.skills || []).length})</AccordionTrigger>
                          <AccordionContent>
                            <div className="flex flex-wrap gap-2">
                              {(metrics.content_metrics.entities.skills || []).map((skill, idx) => (
                                <Badge key={idx} variant="outline">{skill}</Badge>
                              ))}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      )}
                      {(metrics.content_metrics.entities.technologies || []).length > 0 && (
                        <AccordionItem value="tech">
                          <AccordionTrigger>Technologies ({(metrics.content_metrics.entities.technologies || []).length})</AccordionTrigger>
                          <AccordionContent>
                            <div className="flex flex-wrap gap-2">
                              {(metrics.content_metrics.entities.technologies || []).map((tech, idx) => (
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
          )}
        </TabsContent>

        {/* Delivery Analysis Tab */}
        <TabsContent value="delivery" className="space-y-4">
          {metrics.delivery_metrics && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mic className="h-5 w-5" />
                    Speech Metrics (Gentle Analysis)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Speech Rate</div>
                      <div className="text-2xl font-bold">{metrics.delivery_metrics.speech_rate.toFixed(0)} wpm</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Articulation Rate</div>
                      <div className="text-2xl font-bold">{metrics.delivery_metrics.articulation_rate.toFixed(0)} wpm</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Pauses</div>
                      <div className="text-2xl font-bold">{metrics.delivery_metrics.pause_count}</div>
                      <div className="text-xs text-muted-foreground">Avg: {metrics.delivery_metrics.mean_pause_duration.toFixed(2)}s</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Filler Words</div>
                      <div className="text-2xl font-bold">{metrics.delivery_metrics.filler_word_count}</div>
                      <div className="text-xs text-muted-foreground">Rate: {metrics.delivery_metrics.filler_word_rate.toFixed(1)}%</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Voice Quality (Praat Analysis)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Voice Quality Score</span>
                      <Badge>{metrics.delivery_metrics.voice_quality_score.toFixed(1)}/10</Badge>
                    </div>
                    <Progress value={metrics.delivery_metrics.voice_quality_score * 10} />
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Pitch Variation</span>
                      <Badge>{metrics.delivery_metrics.pitch_variation.toFixed(1)}/10</Badge>
                    </div>
                    <Progress value={metrics.delivery_metrics.pitch_variation * 10} />
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Energy Stability</span>
                      <Badge>{metrics.delivery_metrics.energy_stability.toFixed(1)}/10</Badge>
                    </div>
                    <Progress value={metrics.delivery_metrics.energy_stability * 10} />
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Processing Status */}
      <Card className="border-muted">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Processing Status:</span>
            <div className="flex gap-2">
              <Badge variant={metrics.content_processed ? "default" : "secondary"}>
                Content {metrics.content_processed ? '✓' : '⏳'}
              </Badge>
              <Badge variant={metrics.audio_processed ? "default" : "secondary"}>
                Audio {metrics.audio_processed ? '✓' : '⏳'}
              </Badge>
              <Badge variant={metrics.insights_generated ? "default" : "secondary"}>
                Insights {metrics.insights_generated ? '✓' : '⏳'}
              </Badge>
            </div>
          </div>
          {metrics.processing_errors && metrics.processing_errors.length > 0 && (
            <div className="mt-3 text-xs text-yellow-600">
              <AlertCircle className="h-3 w-3 inline mr-1" />
              Some processing warnings occurred
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AdvancedInsights;
