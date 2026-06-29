import { useState, type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Progress } from '../ui/progress';
import { MessageSquare, TrendingUp, Download, RefreshCw, FileText, Loader2, Mic } from 'lucide-react';
import { Button } from '../ui/button';
import { getAuthHeaders } from '@/lib/api-client';
import { useUserExportFlags } from '@/hooks/useUserExportFlags';
import { toast } from 'sonner';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

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
  onExportPdf?: () => Promise<void>;
  pdfLoading?: boolean;
  /** Optional content rendered beside Speaking Performance (e.g. Coaching Insights). */
  aside?: ReactNode;
}

export function SessionMetrics({ sessionId, metrics, onDownloadTranscript, onExportPdf, pdfLoading, aside }: SessionMetricsProps) {
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [isDownloadingAudio, setIsDownloadingAudio] = useState(false);
  const [reprocessStatus, setReprocessStatus] = useState<string>('');
  const exportFlags = useUserExportFlags();

  const downloadAudioFiles = async (onlyUser: boolean) => {
    setIsDownloadingAudio(true);
    try {
      const listResponse = await fetch(`${API_BASE_URL}/api/downloads/sessions/${sessionId}/audio`, {
        headers: getAuthHeaders(),
      });
      if (!listResponse.ok) {
        throw new Error(`Failed to list audio files: ${listResponse.statusText}`);
      }

      const listJson = await listResponse.json();
      const allFiles = Array.isArray(listJson?.audioFiles) ? listJson.audioFiles : [];
      const selectedFiles = onlyUser
        ? allFiles.filter((f: any) => String(f?.filename || '').toLowerCase().includes('user'))
        : allFiles;

      if (selectedFiles.length === 0) {
        toast.error(onlyUser ? 'No user audio file found for this session' : 'No audio files found for this session');
        return;
      }

      for (const file of selectedFiles) {
        const fileUrl = String(file?.url || '');
        const fileName = String(file?.filename || 'session-audio.wav');
        if (!fileUrl) continue;

        const absoluteUrl = fileUrl.startsWith('http') ? fileUrl : `${API_BASE_URL}${fileUrl}`;
        const fileResponse = await fetch(absoluteUrl, { headers: getAuthHeaders() });
        if (!fileResponse.ok) continue;

        const blob = await fileResponse.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }

      toast.success(onlyUser ? 'User audio downloaded' : 'Session audio downloaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download audio';
      toast.error(message);
    } finally {
      setIsDownloadingAudio(false);
    }
  };

  const handleReprocess = async () => {
    setIsReprocessing(true);
    setReprocessStatus('Starting reprocessing...');
    
    try {
      const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/reprocess`, {
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

  type Rating = { label: string; textColor: string; bgColor: string }

  const GOOD: Rating = { label: 'good', textColor: 'text-green-700', bgColor: 'bg-green-100 border-green-200' }
  const AVERAGE: Rating = { label: 'average', textColor: 'text-amber-700', bgColor: 'bg-amber-100 border-amber-200' }
  const NEEDS_WORK: Rating = { label: 'needs improvement', textColor: 'text-red-700', bgColor: 'bg-red-100 border-red-200' }

  const rateWpm = (wpm: number): Rating => {
    if (wpm >= 120) return GOOD
    if (wpm >= 80) return AVERAGE
    return NEEDS_WORK
  }

  const rateFillerRate = (rate: number): Rating => {
    if (rate <= 3) return GOOD
    if (rate <= 6) return AVERAGE
    return NEEDS_WORK
  }

  const rateVocabDiversity = (diversity: number): Rating => {
    if (diversity >= 60) return GOOD
    if (diversity >= 40) return AVERAGE
    return NEEDS_WORK
  }

  // Vocabulary diversity is a type/token ratio, so it is always ≤ 1 when stored
  // correctly (0–1). Some older sessions persisted it pre-scaled as a 0–100
  // percentage; normalize both to a single 0–100 percentage for display/rating
  // so we never show absurd values like 2141%.
  const vocabDiversityPct =
    metrics.userVocabDiversity > 1
      ? metrics.userVocabDiversity
      : metrics.userVocabDiversity * 100

  const wpmRating = rateWpm(metrics.userWpm)
  const fillerRating = rateFillerRate(metrics.userFillerRate)
  const vocabRating = rateVocabDiversity(vocabDiversityPct)

  const RatingBadge = ({ rating }: { rating: Rating }) => (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${rating.bgColor} ${rating.textColor}`}>
      {rating.label}
    </span>
  )

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
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              {exportFlags.enableReprocess && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleReprocess}
                  disabled={isReprocessing}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isReprocessing ? 'animate-spin' : ''}`} />
                  {isReprocessing ? 'Reprocessing...' : 'Reprocess Audio'}
                </Button>
              )}
              {onExportPdf && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onExportPdf}
                  disabled={pdfLoading}
                >
                  {pdfLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                  Export PDF
                </Button>
              )}
              {exportFlags.enableTxtExport && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDownloadTranscript?.('txt')}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download TXT
                </Button>
              )}
              {exportFlags.enableJsonExport && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDownloadTranscript?.('json')}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download JSON
                </Button>
              )}
              {exportFlags.enableAudioExport && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadAudioFiles(true)}
                  disabled={isDownloadingAudio}
                >
                  {isDownloadingAudio ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mic className="h-4 w-4 mr-2" />}
                  Download My Audio
                </Button>
              )}
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
      <div className={`grid gap-6 ${aside ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
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
                <RatingBadge rating={wpmRating} />
              </div>
              <div className="text-2xl font-bold">{metrics.userWpm.toFixed(0)} WPM</div>
              <Progress value={Math.min((metrics.userWpm / 200) * 100, 100)} className="mt-2" />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Filler Word Rate</span>
                <RatingBadge rating={fillerRating} />
              </div>
              <div className="text-2xl font-bold">{metrics.userFillerRate.toFixed(1)}%</div>
              <div className="text-sm text-muted-foreground">
                {metrics.userFillerCount} filler words used
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Vocabulary Diversity</span>
                <RatingBadge rating={vocabRating} />
              </div>
              <div className="text-2xl font-bold">{vocabDiversityPct.toFixed(1)}%</div>
              <Progress value={Math.min(vocabDiversityPct, 100)} className="mt-2" />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Total Speaking Time</span>
              </div>
              <div className="text-2xl font-bold">{(metrics.userSpeakingTime / 60).toFixed(1)} min</div>
              <div className="text-sm text-muted-foreground">
                {Math.round(metrics.userSpeakingTime)} seconds active
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Avg Sentence Length</span>
              </div>
              <div className="text-2xl font-bold">{metrics.userAvgSentenceLength.toFixed(1)}</div>
              <div className="text-sm text-muted-foreground">words per sentence</div>
            </div>
          </CardContent>
        </Card>

        {aside}
      </div>
    </div>
  );
}

export default SessionMetrics;
