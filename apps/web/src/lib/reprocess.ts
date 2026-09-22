import { getAuthHeaders } from '@/lib/api-client'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

const POLL_INTERVAL_MS = 5000
const MAX_WAIT_MS = 20 * 60 * 1000

export type ReprocessOutcome =
  | { status: 'completed'; message: string }
  | { status: 'completed_text_fallback'; message: string }
  | { status: 'unknown'; message: string }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Audio reprocessing runs for minutes on the server, so the POST only starts
 * the job (202) and the outcome is polled. Rejects if the job fails or the
 * wait budget runs out; the server keeps working in the latter case.
 */
export async function runReprocess(
  sessionId: string,
  onProgress?: (message: string) => void,
): Promise<ReprocessOutcome> {
  onProgress?.('Starting reprocessing…')

  const startRes = await fetch(`${API_BASE_URL}/sessions/${sessionId}/reprocess`, {
    method: 'POST',
    headers: getAuthHeaders(),
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

  const deadline = Date.now() + MAX_WAIT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)

    const statusRes = await fetch(
      `${API_BASE_URL}/sessions/${sessionId}/reprocess-status`,
      { headers: getAuthHeaders() },
    )
    if (!statusRes.ok) continue

    const job = await statusRes.json().catch(() => null)
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

    const elapsedMin = Math.floor((Date.now() - (deadline - MAX_WAIT_MS)) / 60000)
    onProgress?.(
      elapsedMin > 0
        ? `Analyzing audio… (${elapsedMin} min)`
        : 'Analyzing audio… this can take a few minutes',
    )
  }

  throw new Error('Reprocessing is taking longer than expected. Reload in a few minutes.')
}
