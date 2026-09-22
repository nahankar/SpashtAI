import { describe, expect, it } from 'vitest'
import { getReprocessJob, startReprocessJob } from '../src/lib/reprocessJobs'

const settle = (sessionId: string) =>
  new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 5000
    const tick = () => {
      const job = getReprocessJob(sessionId)
      if (job && job.status !== 'processing') return resolve()
      if (Date.now() > deadline) return reject(new Error('job did not settle'))
      setTimeout(tick, 20)
    }
    tick()
  })

describe('reprocess job registry', () => {
  it('returns immediately while the analysis keeps running', async () => {
    const sessionId = 'session_async'
    const job = startReprocessJob(sessionId, process.execPath, [
      '-e',
      'setTimeout(() => console.log(JSON.stringify({ success: true })), 100)',
    ])

    expect(job.status).toBe('processing')

    await settle(sessionId)
    expect(getReprocessJob(sessionId)?.status).toBe('completed')
    expect(getReprocessJob(sessionId)?.result).toEqual({ success: true })
  })

  it('reuses the running job so repeated clicks cannot spawn a second analysis', async () => {
    const sessionId = 'session_duplicate_click'
    const args = ['-e', 'setTimeout(() => console.log("{}"), 150)']

    const first = startReprocessJob(sessionId, process.execPath, args)
    const second = startReprocessJob(sessionId, process.execPath, args)

    expect(second).toBe(first)
    expect(second.startedAt).toBe(first.startedAt)

    await settle(sessionId)
  })

  it('records a failure with the interpreter that was used', async () => {
    const sessionId = 'session_failure'
    startReprocessJob(sessionId, process.execPath, [
      '-e',
      'console.error("ModuleNotFoundError: No module named \'numpy\'"); process.exit(1)',
    ])

    await settle(sessionId)
    const job = getReprocessJob(sessionId)
    expect(job?.status).toBe('failed')
    expect(job?.error).toContain(process.execPath)
    expect(job?.error).toContain('numpy')
  })
})
