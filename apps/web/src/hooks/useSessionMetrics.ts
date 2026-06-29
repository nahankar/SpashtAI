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

  const hasAgentGroundedMetrics = (data: any): boolean =>
    Number(data?.userWpm || 0) > 0 &&
    Number(data?.userSpeakingTime || 0) > 0 &&
    Number(data?.totalTurns || 0) > 0;

  const shouldRecomputeFromTranscript = (data: any, messageCount: number): boolean => {
    // Agent saves VAD-measured WPM at session end — do not overwrite with
    // text-only estimates (they use wall-clock and fragment-inflated turn counts).
    if (hasAgentGroundedMetrics(data)) return false;

    const expectedTurns = Math.floor(messageCount / 2);
    const currentTurns = Number(data?.totalTurns || 0);
    const endedAt = data?.session?.endedAt;

    if (isAllZeros(data)) return true;

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

// Shared per-turn records fetch (powers the pace trend + summary strip) so the
// completed-session view only hits /turns once instead of per-component.
export interface SessionTurnRecord {
  turnIndex: number
  role: string
  text?: string
  audioStart?: number | null
  audioEnd?: number | null
  metrics?: any
  score?: any
}

export function useSessionTurns(
  sessionId: string | null,
  enabled = true,
): { turns: SessionTurnRecord[]; loading: boolean } {
  const [turns, setTurns] = useState<SessionTurnRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE_URL}/sessions/${sessionId}/turns`, { headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setTurns(Array.isArray(data.turns) ? data.turns : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, enabled]);

  return { turns, loading };
}

// Hook for real-time metrics updates during active sessions.
// The agent publishes a snapshot to the LiveKit `lk.metrics` data-channel
// topic every ~12s; this hook stores the latest one for the live overlay.
export interface LiveMetricsSnapshot {
  totalTurns: number;
  userWpm: number;
  userFillerRate: number;
  responseTimeAvg: number;
  conversationLatency: number;
  // Enriched fields (added when agent supports them; older agents will leave undefined).
  userTotalWords?: number;
  userSpeakingSeconds?: number;
  userFillerCount?: number;
  userVocabDiversity?: number;
  pacingQualitative?: 'slow' | 'measured' | 'ideal' | 'fast' | 'rapid' | 'not-enough-data';
  coachingTip?: string;
  // Wall-clock timestamp from the agent (epoch seconds) — useful to detect stale snapshots.
  publishedAt?: number;
}

export function useRealTimeMetrics() {
  const [currentMetrics, setCurrentMetrics] = useState<LiveMetricsSnapshot | null>(null);

  const updateMetrics = (metricsUpdate: any) => {
    const cm = metricsUpdate?.current_metrics;
    if (!cm) return;
    setCurrentMetrics({
      totalTurns: Number(cm.total_turns) || 0,
      userWpm: Number(cm.user_wpm) || 0,
      userFillerRate: Number(cm.user_filler_rate) || 0,
      responseTimeAvg: Number(cm.response_time_avg) || 0,
      conversationLatency: Number(cm.conversation_latency) || 0,
      userTotalWords: cm.user_total_words,
      userSpeakingSeconds: cm.user_speaking_seconds,
      userFillerCount: cm.user_filler_count,
      userVocabDiversity: cm.user_vocab_diversity,
      pacingQualitative: cm.pacing_qualitative,
      coachingTip: cm.coaching_tip,
      publishedAt: metricsUpdate.timestamp,
    });
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
