import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyReprocessJob, isAbortError, reprocessProgressMessage, waitForReprocess } from './reprocess'

vi.mock('@/lib/api-client', () => ({ getAuthHeaders: () => ({}) }))

const PAGE_LOAD = Date.parse('2026-09-24T10:00:00Z')

describe('classifyReprocessJob', () => {
  it('resumes a job that is still running on the server', () => {
    expect(classifyReprocessJob({ status: 'processing', startedAt: '2026-09-24T09:59:00Z' }, PAGE_LOAD)).toBe('resume')
  })

  it('reports results that finished after this page loaded', () => {
    expect(
      classifyReprocessJob({ status: 'completed', finishedAt: '2026-09-24T10:05:00Z' }, PAGE_LOAD),
    ).toBe('finished_unseen')
    expect(
      classifyReprocessJob({ status: 'failed', finishedAt: '2026-09-24T10:05:00Z', error: 'x' }, PAGE_LOAD),
    ).toBe('failed_unseen')
  })

  it('ignores jobs already reflected in the loaded page or not started', () => {
    expect(classifyReprocessJob({ status: 'completed', finishedAt: '2026-09-24T09:00:00Z' }, PAGE_LOAD)).toBe('none')
    expect(classifyReprocessJob({ status: 'unknown' }, PAGE_LOAD)).toBe('none')
    expect(classifyReprocessJob(null, PAGE_LOAD)).toBe('none')
  })
})

describe('reprocessProgressMessage', () => {
  it('reports elapsed time from the server start, not the remount', () => {
    const start = PAGE_LOAD
    expect(reprocessProgressMessage(start, start + 30_000)).toBe('Analyzing audio… this can take a few minutes')
    expect(reprocessProgressMessage(start, start + 3 * 60_000 + 5_000)).toBe('Analyzing audio… (3 min)')
  })
})

describe('waitForReprocess', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stops polling when the view unmounts, without treating it as a failure', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const pending = waitForReprocess('s1', { signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toSatisfy(isAbortError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves when the server job completes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'processing' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) })
    vi.stubGlobal('fetch', fetchMock)
    const progress: string[] = []

    const pending = waitForReprocess('s1', { onProgress: (m) => progress.push(m) })
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(pending).resolves.toEqual({ status: 'completed', message: 'Reprocessing complete' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('/sessions/s1/reprocess-status')
    expect(progress.length).toBeGreaterThan(0)
  })
})
