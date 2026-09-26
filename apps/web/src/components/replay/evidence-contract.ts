export interface Clip { start: number; end: number }
export interface ReplayEvidence {
  version: string
  transcriptRevision: string
  state: 'available' | 'partial' | 'empty' | 'unavailable'
  reason: string | null
  coverage: number
  eligibleWords: number
  excludedWords: number
  recording: { uploadId: string; signature: string; duration: number | null } | null
  identity: { state: string; speaker: string | null; revision: string | null }
  speakers: { speaker: string; excerpt: string; preview: Clip | null }[]
  source: string
  accuracy: string
  measurement: string
  limitations: string[]
  supplementaryTranscript: { revision: string | null; status: string } | null
  pace: { wpm: number | null; status: string }
  moments: (Clip & { id: string; description: string; limitation: string; gapSeconds: number })[]
}
export interface ReplayEvidenceResponse {
  session: { id: string; sessionName?: string | null; meetingType: string; status: string; participantName?: string | null }
  evidence: ReplayEvidence
  transcriptHidden: boolean
  transcriptJsonExportDisabled: boolean
  audioDownloadDisabled: boolean
  result: {
    transcriptText: string
    structuredTranscript: { speaker: string; text: string }[]
    wordShare: number | null
    fillerWordCount: number | null
    fillerWordRate: number | null
    avgSentenceLength: number | null
    vocabularyDiversity: number | null
    feedbackScope: string
    strengths: { point: string; example?: string }[]
    improvements: { point: string; suggestion?: string }[]
    recommendations: string[]
    contextSpecificFeedback: { label: string; detail: string }[]
  }
}
