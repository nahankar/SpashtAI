import { spawn } from 'child_process'

export type ReprocessJobStatus = 'processing' | 'completed' | 'failed'

export interface ReprocessJob {
  sessionId: string
  status: ReprocessJobStatus
  startedAt: string
  finishedAt?: string
  result?: unknown
  error?: string
}

// Audio reprocessing (Gentle alignment + Praat + spaCy) runs for minutes, well
// past the 100s Cloudflare proxy timeout, so it cannot be awaited inside the
// request. Jobs live here and the client polls for the outcome.
const jobs = new Map<string, ReprocessJob>()
const FINISHED_JOB_TTL_MS = 30 * 60 * 1000

export function getReprocessJob(sessionId: string): ReprocessJob | null {
  return jobs.get(sessionId) ?? null
}

function retire(sessionId: string) {
  setTimeout(() => {
    const job = jobs.get(sessionId)
    if (job && job.status !== 'processing') jobs.delete(sessionId)
  }, FINISHED_JOB_TTL_MS).unref?.()
}

/** Starts a job, or returns the one already running for this session. */
export function startReprocessJob(
  sessionId: string,
  pythonEnv: string,
  args: string[],
): ReprocessJob {
  const running = jobs.get(sessionId)
  if (running?.status === 'processing') return running

  const job: ReprocessJob = {
    sessionId,
    status: 'processing',
    startedAt: new Date().toISOString(),
  }
  jobs.set(sessionId, job)

  const python = spawn(pythonEnv, args)
  let output = ''
  let errorOutput = ''

  python.stdout.on('data', (data: Buffer) => {
    output += data.toString()
  })
  python.stderr.on('data', (data: Buffer) => {
    errorOutput += data.toString()
  })

  const fail = (message: string) => {
    job.status = 'failed'
    job.error = message
    job.finishedAt = new Date().toISOString()
    console.error(`Reprocess job failed for ${sessionId}: ${message}`)
    retire(sessionId)
  }

  python.on('error', (err: Error) => {
    fail(`Could not start ${pythonEnv}: ${err.message}`)
  })

  python.on('close', (code: number) => {
    if (job.status !== 'processing') return
    if (code !== 0) {
      fail(`Python script exited with code ${code} (interpreter ${pythonEnv}): ${errorOutput}`)
      return
    }
    try {
      job.result = JSON.parse(output)
    } catch {
      job.result = { raw: output }
    }
    job.status = 'completed'
    job.finishedAt = new Date().toISOString()
    retire(sessionId)
  })

  return job
}
