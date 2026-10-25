import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import type { Assessment } from '@/lib/interview-evaluator'

export type LearnerFinding = { attemptId: string; index: number; question: string; status: string; errorCode: string | null; assistance: string; afterExample: boolean;
  result: Omit<NonNullable<Assessment['result']>, 'next'> | null }

export const PENDING_FINDING = ['PENDING', 'RUNNING']

/** One owner-scoped read of a practice's technical findings, refreshed every second only while one is pending. */
export function useInterviewFindings({ runId, sessionId, refreshKey = '' }: { runId?: string; sessionId?: string; refreshKey?: string }) {
  const [rows, setRows] = useState<LearnerFinding[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // A different practice starts empty; a refresh of the same one keeps its findings on screen.
  useEffect(() => { setRows([]); setLoaded(false); setError(false) }, [runId, sessionId])
  useEffect(() => {
    if (!runId && !sessionId) return
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    const path = runId ? `/runs/${encodeURIComponent(runId)}` : `/playback/${encodeURIComponent(sessionId!)}`
    async function load() {
      try {
        const result = await apiClient<{ assessments: LearnerFinding[] }>(`/api/interviews${path}/assessments`, { signal: abort.signal })
        if (abort.signal.aborted) return
        setRows(result.assessments); setLoaded(true); setError(false)
        // Evaluations usually finish within a few seconds of saving; check every second while one is running.
        if (result.assessments.some(r => PENDING_FINDING.includes(r.status))) timer = setTimeout(() => void load(), 1000)
      } catch { if (!abort.signal.aborted) { setError(true); setLoaded(true) } }
    }
    void load()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [runId, sessionId, refreshKey, attempt])
  const byAttempt = useMemo(() => new Map(rows.map(row => [row.attemptId, row])), [rows])
  const retry = useCallback(() => setAttempt(n => n + 1), [])
  return { rows, byAttempt, loaded, error, retry }
}
