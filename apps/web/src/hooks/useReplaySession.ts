import { useState, useCallback, useRef, useEffect } from 'react'
import { getAuthHeaders } from '@/lib/api-client'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export interface ReplayContext {
  meetingType: string
  userRole: string
  focusAreas: string[]
  meetingGoal?: string
  meetingDate?: string
  participantName?: string
}

export interface ReplaySessionStatus {
  id: string
  status: 'pending' | 'transcribing' | 'analyzing' | 'completed' | 'failed'
  errorMessage?: string | null
}

export interface ReplayUploadRecord {
  id: string
  fileType: string
  originalName: string
  fileSize: number
  duration?: number | null
}

export interface ReplayResultData {
  session: {
    id: string
    meetingType: string
    userRole: string
    focusAreas: string[]
    meetingGoal?: string | null
    meetingDate?: string | null
    participantName?: string | null
    status: string
    createdAt: string
  }
  uploads: ReplayUploadRecord[]
  result: {
    transcriptText: string
    structuredTranscript: any
    speakerCount: number
    transcriptionSource: string
    wordsPerMinute: number
    fillerWordCount: number
    fillerWordRate: number
    avgSentenceLength: number
    vocabularyDiversity: number
    totalTurns: number
    speakingPercentage: number
    overallScore: number
    clarityScore: number
    confidenceScore: number
    engagementScore: number
    strengths: { point: string; example?: string }[]
    improvements: { point: string; example?: string; suggestion?: string }[]
    recommendations: string[]
    contextSpecificFeedback: { label: string; detail: string; rating?: string }[]
    keyMoments: { text: string; type: string }[]
    annotatedTranscript: { speaker: string; text: string; annotations?: string[] }[]
    modelUsed?: string
    promptTokens: number
    completionTokens: number
    processingTimeMs: number
  }
}

export function useReplaySession() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<ReplaySessionStatus | null>(null)
  const [results, setResults] = useState<ReplayResultData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  const createSession = useCallback(async (context: ReplayContext): Promise<string> => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/replay/sessions`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(context),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create session')
      const data = await res.json()
      setSessionId(data.sessionId)
      return data.sessionId
    } catch (e: any) {
      setError(e.message)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  const uploadFiles = useCallback(
    async (sid: string, files: { audio?: File; transcript?: File; text?: string }) => {
      setError(null)
      setLoading(true)
      try {
        const form = new FormData()
        if (files.audio) form.append('audio', files.audio)
        if (files.transcript) form.append('transcript', files.transcript)
        if (files.text) form.append('text', files.text)

        const token = localStorage.getItem('spashtai_token')
        const res = await fetch(`${API_BASE_URL}/api/replay/sessions/${sid}/upload`, {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          body: form,
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Upload failed')
        return await res.json()
      } catch (e: any) {
        setError(e.message)
        throw e
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const startProcessing = useCallback(
    async (sid: string) => {
      setError(null)
      try {
        const res = await fetch(`${API_BASE_URL}/api/replay/sessions/${sid}/process`, {
          method: 'POST',
          headers: getAuthHeaders(),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to start processing')

        // Begin polling
        pollRef.current = setInterval(async () => {
          try {
            const statusRes = await fetch(`${API_BASE_URL}/api/replay/sessions/${sid}/status`, {
              headers: getAuthHeaders(),
            })
            if (!statusRes.ok) return
            const statusData: ReplaySessionStatus = await statusRes.json()
            setStatus(statusData)

            if (statusData.status === 'completed') {
              stopPolling()
              const resultsRes = await fetch(`${API_BASE_URL}/api/replay/sessions/${sid}/results`, {
                headers: getAuthHeaders(),
              })
              if (resultsRes.ok) {
                setResults(await resultsRes.json())
              }
            } else if (statusData.status === 'failed') {
              stopPolling()
              setError(statusData.errorMessage || 'Processing failed')
            }
          } catch {
            // polling failure is transient
          }
        }, 3000)
      } catch (e: any) {
        setError(e.message)
        throw e
      }
    },
    [stopPolling]
  )

  const fetchResults = useCallback(async (sid: string) => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/replay/sessions/${sid}/results`, {
        headers: getAuthHeaders(),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch results')
      const data: ReplayResultData = await res.json()
      setResults(data)
      setSessionId(sid)
      return data
    } catch (e: any) {
      setError(e.message)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    sessionId,
    status,
    results,
    error,
    loading,
    createSession,
    uploadFiles,
    startProcessing,
    fetchResults,
  }
}
