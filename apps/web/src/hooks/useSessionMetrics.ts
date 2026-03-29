import { useState, useEffect } from 'react';
import { getAuthHeaders } from '@/lib/api-client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

interface SessionMetrics {
  // LiveKit metrics
  totalLlmTokens: number;
  totalLlmDuration: number;
  avgTtft: number;
  totalTtsDuration: number;
  totalTtsAudioDuration: number;
  avgTtsTtfb: number;
  totalEouDelay: number;
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
  assistantFillerCount: number;
  assistantFillerRate: number;
  assistantAvgSentenceLength: number;
  assistantSpeakingTime: number;
  assistantVocabDiversity: number;
  assistantResponseTimeAvg: number;
  
  totalTurns: number;
}

interface UseSessionMetricsReturn {
  metrics: SessionMetrics | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  downloadTranscript: (format: 'json' | 'txt') => Promise<void>;
}

export function useSessionMetrics(sessionId: string | null): UseSessionMetricsReturn {
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAllZeros = (data: any): boolean => {
    return (
      data.userWpm === 0 &&
      data.userFillerCount === 0 &&
      data.totalTurns === 0 &&
      data.totalLlmTokens === 0
    );
  };

  const fetchConversationMessageCount = async (id: string): Promise<number> => {
    try {
      const response = await fetch(`${API_BASE_URL}/sessions/${id}/conversation`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) return 0;
      const payload = await response.json();
      return Array.isArray(payload?.messages) ? payload.messages.length : 0;
    } catch {
      return 0;
    }
  };

  const shouldRecomputeFromTranscript = (data: any, messageCount: number): boolean => {
    // Conservative expected turns from persisted transcript messages.
    const expectedTurns = Math.floor(messageCount / 2);
    const currentTurns = Number(data?.totalTurns || 0);
    const endedAt = data?.session?.endedAt;

    // Always allow fallback on empty metrics.
    if (isAllZeros(data)) return true;

    // For ended sessions, recompute if transcript has grown but metrics lag behind.
    if (endedAt && expectedTurns > currentTurns) return true;

    return false;
  };

  const fetchMetrics = async () => {
    if (!sessionId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/metrics`, {
        headers: getAuthHeaders(),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch metrics: ${response.statusText}`);
      }

      let data = await response.json();
      const messageCount = await fetchConversationMessageCount(sessionId);

      if (shouldRecomputeFromTranscript(data, messageCount)) {
        try {
          const calcResponse = await fetch(
            `${API_BASE_URL}/sessions/${sessionId}/calculate-text-metrics`,
            { method: 'POST', headers: getAuthHeaders() }
          );
          if (calcResponse.ok) {
            const refreshed = await fetch(`${API_BASE_URL}/sessions/${sessionId}/metrics`, {
              headers: getAuthHeaders(),
            });
            if (refreshed.ok) {
              data = await refreshed.json();
            }
          }
        } catch {
          // Text-based calculation not available; use whatever we have
        }
      }

      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching session metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  const downloadTranscript = async (format: 'json' | 'txt') => {
    if (!sessionId) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/sessions/${sessionId}/transcript/download?format=${format}`,
        { headers: getAuthHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Failed to download transcript: ${response.statusText}`);
      }

      // Get filename from response headers or create default
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename = contentDisposition
        ? contentDisposition.split('filename=')[1]?.replace(/"/g, '')
        : `transcript-${sessionId}.${format}`;

      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Error downloading transcript:', err);
      setError(err instanceof Error ? err.message : 'Failed to download transcript');
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, [sessionId]);

  return {
    metrics,
    loading,
    error,
    refetch: fetchMetrics,
    downloadTranscript,
  };
}

// Hook for real-time metrics updates during active sessions
export function useRealTimeMetrics() {
  const [currentMetrics, setCurrentMetrics] = useState<{
    totalTurns: number;
    userWpm: number;
    userFillerRate: number;
    responseTimeAvg: number;
    conversationLatency: number;
  } | null>(null);

  const updateMetrics = (metricsUpdate: any) => {
    if (metricsUpdate.current_metrics) {
      setCurrentMetrics(metricsUpdate.current_metrics);
    }
  };

  const resetMetrics = () => {
    setCurrentMetrics(null);
  };

  return {
    currentMetrics,
    updateMetrics,
    resetMetrics,
  };
}
