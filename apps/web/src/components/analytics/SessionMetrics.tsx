import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { Clock, MessageSquare, Zap, TrendingUp, Download, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { getAuthHeaders } from '@/lib/api-client';

interface SessionMetricsProps {
  sessionId: string;
  metrics?: {
    // LiveKit metrics
    totalLlmTokens: number;
    totalLlmDuration: number;
    avgTtft: number;
    totalTtsDuration: number;
    conversationLatencyAvg: number;
    
    // User metrics
    userWpm: number;
    userFillerCount: number;
    userFillerRate: number;
    userAvgSentenceLength: number;
    userSpeakingTime: number;
    userVocabDiversity: number;
    userResponseTimeAvg: number;
    
    // Assistant metrics
    assistantWpm: number;
    assistantFillerRate: number;
    assistantSpeakingTime: number;
    
    totalTurns: number;
  };
  onDownloadTranscript?: (format: 'json' | 'txt') => void;
}

export function SessionMetrics({ sessionId, metrics, onDownloadTranscript }: SessionMetricsProps) {
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [reprocessStatus, setReprocessStatus] = useState<string>('');

  const handleReprocess = async () => {
    setIsReprocessing(true);
    setReprocessStatus('Starting reprocessing...');
    
    try {
      const response = await fetch(`http://localhost:4000/sessions/${sessionId}/reprocess`, {
        method: 'POST',
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Reprocessing failed');
      }

      const result = await response.json();
      setReprocessStatus('✅ Reprocessing complete! Refreshing metrics...');
      
      // Reload the page after 2 seconds to show updated metrics
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      setReprocessStatus(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setTimeout(() => setReprocessStatus(''), 5000);
    } finally {
      setIsReprocessing(false);
    }
  };

  if (!metrics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Session Analytics</CardTitle>
          <CardDescription>No metrics available for this session</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const getWpmStatus = (wpm: number) => {
    if (wpm >= 140) return { status: 'excellent', color: 'bg-green-500' };
    if (wpm >= 120) return { status: 'good', color: 'bg-blue-500' };
    if (wpm >= 100) return { status: 'average', color: 'bg-yellow-500' };
    return { status: 'needs improvement', color: 'bg-red-500' };
  };

  const getFillerRateStatus = (rate: number) => {
    if (rate <= 2) return { status: 'excellent', color: 'bg-green-500' };
    if (rate <= 5) return { status: 'good', color: 'bg-blue-500' };
    if (rate <= 8) return { status: 'average', color: 'bg-yellow-500' };
    return { status: 'needs improvement', color: 'bg-red-500' };
  };

  const getLatencyStatus = (latency: number) => {
    if (latency <= 1.0) return { status: 'excellent', color: 'bg-green-500' };
    if (latency <= 2.0) return { status: 'good', color: 'bg-blue-500' };
    if (latency <= 3.0) return { status: 'average', color: 'bg-yellow-500' };
    return { status: 'needs improvement', color: 'bg-red-500' };
  };

  const wpmStatus = getWpmStatus(metrics.userWpm);
  const fillerStatus = getFillerRateStatus(metrics.userFillerRate);
  const latencyStatus = getLatencyStatus(metrics.conversationLatencyAvg);

  return (
    <div className="space-y-6">
      {/* Header with Download Options */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Session Analytics
            </CardTitle>
            <CardDescription>
              Comprehensive metrics for session {sessionId.slice(0, 8)}...
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleReprocess}
                disabled={isReprocessing}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isReprocessing ? 'animate-spin' : ''}`} />
                {isReprocessing ? 'Reprocessing...' : 'Reprocess Audio'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDownloadTranscript?.('txt')}
              >
                <Download className="h-4 w-4 mr-2" />
                Download TXT
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDownloadTranscript?.('json')}
              >
              <Download className="h-4 w-4 mr-2" />
              Download JSON
            </Button>
            </div>
            {reprocessStatus && (
              <div className="text-sm text-muted-foreground mt-2">
                {reprocessStatus}
              </div>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Key Performance Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Speaking Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Speaking Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Words Per Minute</span>
                <Badge variant={wpmStatus.status === 'excellent' ? 'default' : 'secondary'}>
                  {wpmStatus.status}
                </Badge>
              </div>
              <div className="text-2xl font-bold">{metrics.userWpm.toFixed(0)} WPM</div>
              <Progress value={Math.min((metrics.userWpm / 200) * 100, 100)} className="mt-2" />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Filler Word Rate</span>
                <Badge variant={fillerStatus.status === 'excellent' ? 'default' : 'secondary'}>
                  {fillerStatus.status}
                </Badge>
              </div>
              <div className="text-2xl font-bold">{metrics.userFillerRate.toFixed(1)}%</div>
              <div className="text-sm text-muted-foreground">
                {metrics.userFillerCount} filler words used
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Vocabulary Diversity</span>
              </div>
              <div className="text-2xl font-bold">{metrics.userVocabDiversity.toFixed(1)}%</div>
              <Progress value={metrics.userVocabDiversity} className="mt-2" />
            </div>
          </CardContent>
        </Card>

        {/* Conversation Flow */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Conversation Flow
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Response Time</span>
              </div>
              <div className="text-2xl font-bold">{metrics.userResponseTimeAvg.toFixed(1)}s</div>
              <div className="text-sm text-muted-foreground">
                Average time to respond
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Conversation Latency</span>
                <Badge variant={latencyStatus.status === 'excellent' ? 'default' : 'secondary'}>
                  {latencyStatus.status}
                </Badge>
              </div>
              <div className="text-2xl font-bold">{metrics.conversationLatencyAvg.toFixed(2)}s</div>
              <div className="text-sm text-muted-foreground">
                System response delay
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Total Turns</span>
              </div>
              <div className="text-2xl font-bold">{metrics.totalTurns}</div>
              <div className="text-sm text-muted-foreground">
                Back-and-forth exchanges
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Technical Metrics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Technical Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">LLM Tokens Used</span>
              </div>
              <div className="text-2xl font-bold">{metrics.totalLlmTokens.toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">
                Total processing cost
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Time to First Token</span>
              </div>
              <div className="text-2xl font-bold">{metrics.avgTtft.toFixed(2)}s</div>
              <div className="text-sm text-muted-foreground">
                AI thinking time
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Speaking Time Ratio</span>
              </div>
              <div className="text-2xl font-bold">
                {(metrics.userSpeakingTime + metrics.assistantSpeakingTime) > 0
                  ? ((metrics.userSpeakingTime / (metrics.userSpeakingTime + metrics.assistantSpeakingTime)) * 100).toFixed(0)
                  : 0}%
              </div>
              <div className="text-sm text-muted-foreground">
                You vs Assistant
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Breakdown</CardTitle>
          <CardDescription>
            Comprehensive analysis of your session performance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <h4 className="font-semibold mb-4">Your Performance</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex justify-between p-3 bg-muted/50 rounded-lg">
                <span className="text-sm">Average Sentence Length:</span>
                <span className="text-sm font-medium">{metrics.userAvgSentenceLength.toFixed(1)} words</span>
              </div>
              <div className="flex justify-between p-3 bg-muted/50 rounded-lg">
                <span className="text-sm">Total Speaking Time:</span>
                <span className="text-sm font-medium">{(metrics.userSpeakingTime / 60).toFixed(1)} minutes</span>
              </div>
              <div className="flex justify-between p-3 bg-muted/50 rounded-lg">
                <span className="text-sm">Words Per Minute:</span>
                <span className="text-sm font-medium">{metrics.userWpm.toFixed(0)} WPM</span>
              </div>
            </div>
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-900 dark:text-blue-100">
                💡 <strong>LLM Processing Time:</strong> {metrics.totalLlmDuration.toFixed(1)}s total for analyzing your responses
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default SessionMetrics;
