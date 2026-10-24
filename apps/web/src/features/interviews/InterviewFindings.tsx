import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { labels, type Assessment } from '@/lib/interview-evaluator'

export type LearnerFinding = { attemptId: string; index: number; question: string; status: string; errorCode: string | null; afterExample: boolean;
  result: Omit<NonNullable<Assessment['result']>, 'next'> | null }

export function InterviewFindings({ runId, sessionId, refreshKey = '' }: { runId?: string; sessionId?: string; refreshKey?: string }) {
  const [rows, setRows] = useState<LearnerFinding[]>([])
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!runId && !sessionId) return
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    setRows([]); setError(false)
    const path = runId ? `/runs/${encodeURIComponent(runId)}` : `/playback/${encodeURIComponent(sessionId!)}`
    async function load() {
      try {
        const result = await apiClient<{ assessments: LearnerFinding[] }>(`/api/interviews${path}/assessments`, { signal: abort.signal })
        if (abort.signal.aborted) return
        setRows(result.assessments); setError(false)
        if (result.assessments.some(r => ['PENDING', 'RUNNING'].includes(r.status))) timer = setTimeout(() => void load(), 3000)
      } catch { if (!abort.signal.aborted) setError(true) }
    }
    void load()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [runId, sessionId, refreshKey])
  const assessed = rows.filter(r => ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(r.status))
  if (!assessed.length && !error) return null
  return <section className="my-5 space-y-3" aria-label="Technical answer feedback">
    <h2 className="text-lg font-semibold">Technical answer feedback</h2>
    <p className="text-sm text-muted-foreground">Based on your saved answers. Separate from communication feedback and Progress Pulse.</p>
    {error && <p role="status" className="text-sm text-muted-foreground">Technical feedback could not be loaded. Reload to retry; your saved answers are safe.</p>}
    {assessed.map(row => <details key={row.attemptId} className="rounded-lg border p-4" open={assessed.length === 1}>
      <summary className="cursor-pointer font-medium">Question {row.index} · {labels[row.status] ?? row.status}{row.result ? ` · ${labels[row.result.classification]}` : ''}</summary>
      <div className="mt-3 space-y-3 text-sm">
        <p>{row.question}</p>
        {row.afterExample && <p className="text-orange-700 dark:text-orange-300">After seeing an example · this response does not establish independent recall.</p>}
        {['PENDING', 'RUNNING'].includes(row.status) && <p role="status">Evaluation is pending. You can continue practicing.</p>}
        {['FAILED', 'CANCELLED'].includes(row.status) && <p>Technical evaluation is unavailable for this answer. No grade was invented.</p>}
        {row.result && <>
          {row.result.validationNotes?.map((note, i) => <p className="text-muted-foreground" key={i}>{note}</p>)}
          <div className="grid gap-3 sm:grid-cols-3">{row.result.criteria.map(c => <div key={c.criterion} className="rounded border p-3 space-y-2">
            <h3 className="font-medium">{labels[c.criterion]}</h3><p>{labels[c.finding]}</p><p>{c.explanation}</p>
            {c.evidence.map((quote, i) => <blockquote className="border-l-2 pl-2" key={i}>“{quote}”</blockquote>)}
          </div>)}</div>
          {([['What was correct', row.result.strengths], ['Missing concepts', row.result.gaps], ['Misconceptions', row.result.misconceptions], ['Uncertainties', row.result.uncertainty]] as const).map(([title, items]) => items.length > 0 && <div key={title}><h3 className="font-medium">{title}</h3><ul className="list-disc pl-5">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>)}
          <p>{row.result.guidance}</p>
        </>}
      </div>
    </details>)}
  </section>
}
