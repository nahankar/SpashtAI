import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { MessageSquare, Clock, TrendingUp, Zap } from 'lucide-react';

interface RealTimeMetricsProps {
  metrics: {
    totalTurns: number;
    userWpm: number;
    userFillerRate: number;
    responseTimeAvg: number;
    conversationLatency: number;
  } | null;
  isVisible?: boolean;
}

export function RealTimeMetrics({ metrics, isVisible = true }: RealTimeMetricsProps) {
  if (!isVisible || !metrics) {
    return null;
  }

  const getWpmColor = (wpm: number) => {
    if (wpm >= 140) return 'text-green-600';
    if (wpm >= 120) return 'text-blue-600';
    if (wpm >= 100) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getFillerRateColor = (rate: number) => {
    if (rate <= 2) return 'text-green-600';
    if (rate <= 5) return 'text-blue-600';
    if (rate <= 8) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getLatencyColor = (latency: number) => {
    if (latency <= 1.0) return 'text-green-600';
    if (latency <= 2.0) return 'text-blue-600';
    if (latency <= 3.0) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <Card className="fixed top-4 right-4 w-80 z-50 bg-background/95 backdrop-blur-sm border shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingUp className="h-4 w-4" />
          Live Performance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              <span className="text-xs text-muted-foreground">Turns</span>
            </div>
            <div className="font-semibold">{metrics.totalTurns}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span className="text-xs text-muted-foreground">Response</span>
            </div>
            <div className="font-semibold">{metrics.responseTimeAvg.toFixed(1)}s</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              <span className="text-xs text-muted-foreground">WPM</span>
            </div>
            <div className={`font-semibold ${getWpmColor(metrics.userWpm)}`}>
              {metrics.userWpm.toFixed(0)}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              <span className="text-xs text-muted-foreground">Latency</span>
            </div>
            <div className={`font-semibold ${getLatencyColor(metrics.conversationLatency)}`}>
              {metrics.conversationLatency.toFixed(2)}s
            </div>
          </div>
        </div>

        <div className="pt-2 border-t">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Filler Rate</span>
            <Badge 
              variant={metrics.userFillerRate <= 5 ? 'default' : 'secondary'}
              className="text-xs px-2 py-0.5"
            >
              {metrics.userFillerRate.toFixed(1)}%
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default RealTimeMetrics;
