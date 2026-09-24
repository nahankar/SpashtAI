import { getAuthHeaders } from '@/lib/api-client'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

const POLL_INTERVAL_MS = 5000
const MAX_WAIT_MS = 20 * 60 * 1000

export type ReprocessOutcome =
  | { status: 'completed'; message: string }
  | { status: 'completed_text_fallback'; message: string }
  | { status: 'unknown'; message: string }

export interface ReprocessJobSnapshot {
  status: 'processing' | 'completed' | 'failed' | 'unknown'
  startedAt?: string
  finishedAt?: string
  error?: string
}

export interface WaitOptions {
  onProgress?: (message: string) => void
  /** Aborting stops polling only; the server job keeps running. */
  signal?: AbortSignal
}

/** Recorded once per page load, so a job that finished later is known to be unseen. */
export const PAGE_LOADED_AT = Date.now()

function abortError(): Error {
  return new DOMException('Reprocess polling stopped', 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function fetchReprocessJob(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ReprocessJobSnapshot | null> {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/reprocess-status`, {
    headers: getAuthHeaders(),
    signal,
  })
  if (!res.ok) return null
  return (await res.json().catch(() => null)) as ReprocessJobSnapshot | null
}

export type ResumedReprocessState = 'resume' | 'finished_unseen' | 'failed_unseen' | 'none'

/**
 * What a freshly mounted view should show for a job that may have been
 * started earlier (for example before switching tabs).
 */
export function classifyReprocessJob(
  job: ReprocessJobSnapshot | null,
  pageLoadedAt: number = PAGE_LOADED_AT,
): ResumedReprocessState {
  if (!job) return 'none'
  if (job.status === 'processing') return 'resume'
  const finishedAt = job.finishedAt ? Date.parse(job.finishedAt) : NaN
  if (!Number.isFinite(finishedAt) || finishedAt < pageLoadedAt) return 'none'
  if (job.status === 'completed') return 'finished_unseen'
  if (job.status === 'failed') return 'failed_unseen'
  return 'none'
}

export function reprocessProgressMessage(startedAt: number, now: number = Date.now()): string {
  const elapsedMin = Math.floor(Math.max(0, now - startedAt) / 60000)
  return elapsedMin > 0
    ? `Analyzing audio… (${elapsedMin} min)`
    : 'Analyzing audio… this can take a few minutes'
}

/**
 * Polls a running server job until it settles. Rejects when the job fails or
 * the wait budget runs out; the server keeps working in either case.
 */
export async function waitForReprocess(
  sessionId: string,
  { onProgress, signal }: WaitOptions = {},
  startedAtIso?: string,
): Promise<ReprocessOutcome> {
  const parsedStart = startedAtIso ? Date.parse(startedAtIso) : NaN
  const startedAt = Number.isFinite(parsedStart) ? parsedStart : Date.now()
  const deadline = Date.now() + MAX_WAIT_MS
  onProgress?.(reprocessProgressMessage(startedAt))

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS, signal)

    let job: ReprocessJobSnapshot | null
    try {
      job = await fetchReprocessJob(sessionId, signal)
    } catch (error) {
      if (isAbortError(error)) throw error
      continue
    }
    if (!job) continue

    if (job.status === 'completed') {
      return { status: 'completed', message: 'Reprocessing complete' }
    }
    if (job.status === 'failed') {
      throw new Error(job.error || 'Reprocessing failed')
    }
    if (job.status === 'unknown') {
      return {
        status: 'unknown',
        message: 'Reprocessing finished or the server restarted. Reload to see the latest metrics.',
      }
    }
    onProgress?.(reprocessProgressMessage(startedAt))
  }

  throw new Error('Reprocessing is taking longer than expected. Reload in a few minutes.')
}

/**
 * Audio reprocessing runs for minutes on the server, so the POST only starts
 * the job (202) and the outcome is polled.
 */
export async function runReprocess(
  sessionId: string,
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
): Promise<ReprocessOutcome> {
  onProgress?.('Starting reprocessing…')

  const startRes = await fetch(`${API_BASE_URL}/sessions/${sessionId}/reprocess`, {
    method: 'POST',
    headers: getAuthHeaders(),
    signal,
  })
  const startBody = await startRes.json().catch(() => ({}))
  if (!startRes.ok) {
    throw new Error(startBody.error || 'Reprocessing failed')
  }

  if (startBody.status === 'completed_text_fallback') {
    return {
      status: 'completed_text_fallback',
      message: startBody.message || 'Recomputed metrics from transcript text.',
    }
  }

  return waitForReprocess(sessionId, { onProgress, signal }, startBody.startedAt)
}
