import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutomaticDeliveryStatusView } from '@/components/analytics/AutomaticDeliveryStatus'
import { Button, type ButtonProps } from '@/components/ui/button'
import {
  EMPTY_ELEVATE_DELIVERY_STATUS,
  elevateDeliveryStatusLabel,
  watchElevateDeliveryStatus,
  type ElevateDeliveryStatus,
} from './elevateDeliveryStatus'

function response(body: unknown, status = 200) {
  return { ok: status === 200, status, json: async () => body }
}

function completed(state: 'complete' | 'partial' = 'partial', acceptedTurnCount = 2) {
  return {
    deliveryAlignmentStatus: 'completed',
    deliveryAlignmentError: null,
    processingStatus: {
      deliveryTiming: {
        state, source: 'forced_alignment', acceptedTurnCount, totalTurnCount: 4,
        liveSource: { sourceOnlyTurns: 2, unavailableTurns: 2, recordingClockMapped: false },
      },
    },
  }
}

function findButtons(node: ReactNode, found: ReactElement<ButtonProps>[] = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => findButtons(child, found))
  } else if (isValidElement<ButtonProps & { children?: ReactNode }>(node)) {
    if (node.type === Button) found.push(node)
    findButtons(node.props.children, found)
  }
  return found
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('Elevate automatic delivery labels', () => {
  it.each([
    ['pending', null, 'Delivery analysis is queued.'],
    ['processing', null, 'Preparing delivery analysis from your recording.'],
    ['retry', 'waiting_for_complete_transcript', 'The full transcript is not available yet.'],
    ['retry', 'waiting_for_recording_or_transcript', 'The recording or transcript is not available yet.'],
    ['retry', 'complete_user_audio_required', 'Some parts of your recording are missing.'],
    ['retry', 'alignment_timeout', 'took longer than expected.'],
    ['retry', 'alignment_service_failed', 'could not finish this attempt.'],
    ['unavailable', 'alignment_coverage_insufficient', 'Too little speech could be matched reliably'],
  ] as const)('renders a human explanation for %s / %s', async (state, reason, expected) => {
    const update = vi.fn()
    const stop = watchElevateDeliveryStatus(
      async () => response({ deliveryAlignmentStatus: state, deliveryAlignmentError: reason }), update,
    )
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
    const status = update.mock.calls[0][0] as ElevateDeliveryStatus
    const html = renderToStaticMarkup(<AutomaticDeliveryStatusView status={status} onRefresh={vi.fn()} />)
    expect(html).toContain(expected)
    expect(html).toContain('role="status"')
    if (state === 'retry') expect(html).toContain('will retry automatically')
    if (state === 'unavailable') expect(html).toContain('Playback and other feedback remain available.')
    if (reason) expect(html).not.toContain(reason)
    stop()
  })

  it('distinguishes partial completion from full coverage, including on first load', async () => {
    for (const [state, count, expected] of [
      ['partial', 2, 'finished with partial coverage'],
      ['complete', 4, 'Delivery analysis is complete.'],
    ] as const) {
      const update = vi.fn()
      const stop = watchElevateDeliveryStatus(async () => response(completed(state, count)), update)
      await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
      const status = update.mock.calls[0][0] as ElevateDeliveryStatus
      const html = renderToStaticMarkup(<AutomaticDeliveryStatusView status={status} onRefresh={vi.fn()} />)
      expect(html).toContain(expected)
      expect(html).toContain(`${count} of 4 speaking turns`)
      expect(html).not.toContain('View updated results')
      expect(html).not.toMatch(/forced_alignment|sourceOnlyTurns|recordingClockMapped/)
      if (state === 'partial') expect(html).toContain('Unverified turns are excluded')
      stop()
    }
  })

  it('never exposes raw machine reasons, paths, or service errors', () => {
    const raw = 'secret_token /private/path HTTP 500 <script>alert("x")</script>'
    for (const state of ['retry', 'unavailable', 'processing', 'completed', null] as const) {
      const html = renderToStaticMarkup(<AutomaticDeliveryStatusView
        status={{ ...EMPTY_ELEVATE_DELIVERY_STATUS, state, reason: raw }}
        onRefresh={vi.fn()}
      />)
      expect(html).toContain('Word timing could not be verified')
      expect(html).not.toMatch(/secret_token|private|HTTP|script/)
    }
  })

  it('does not invent complete coverage for older sessions or malformed counts', async () => {
    for (const body of [
      { deliveryAlignmentStatus: 'completed' },
      completed('complete', 2),
      completed('partial', -1),
      completed('partial', 5),
      completed('partial', 1.2),
    ]) {
      const update = vi.fn()
      const stop = watchElevateDeliveryStatus(async () => response(body), update)
      await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
      const label = elevateDeliveryStatusLabel(update.mock.calls[0][0])
      expect(label).toBe('Delivery analysis is complete.')
      expect(label).not.toContain('speaking turns')
      stop()
    }
  })

  it('keeps updates manual when partial coverage completes after a retry', async () => {
    vi.useFakeTimers()
    const load = vi.fn()
      .mockResolvedValueOnce(response({
        deliveryAlignmentStatus: 'retry', deliveryAlignmentError: 'alignment_timeout',
      }))
      .mockResolvedValueOnce(response(completed()))
    const update = vi.fn()
    const refresh = vi.fn()
    const stop = watchElevateDeliveryStatus(load, update)
    await vi.advanceTimersByTimeAsync(10_000)
    const status = update.mock.calls[1][0] as ElevateDeliveryStatus
    expect(status.ready).toBe(true)
    expect(status.reason).toBeNull()
    const tree = AutomaticDeliveryStatusView({ status, onRefresh: refresh })
    const html = renderToStaticMarkup(tree)
    expect(html).toContain('partial coverage')
    expect(html).toContain('View updated results')
    expect(html).not.toContain('longer than expected')
    expect(refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(2)
    findButtons(tree)[0].props.onClick?.({} as never)
    expect(refresh).toHaveBeenCalledOnce()
    stop()
  })
})

describe('Elevate status polling lifecycle', () => {
  it.each(['request', 'body'])('times out a hung %s and ignores its late completion', async (kind) => {
    vi.useFakeTimers()
    let finishOld!: (value: ReturnType<typeof response> | unknown) => void
    const signals: AbortSignal[] = []
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      if (signals.length > 1) return Promise.resolve(response(completed()))
      if (kind === 'body') return Promise.resolve({
        ok: true, status: 200,
        json: () => new Promise(resolve => { finishOld = resolve }),
      })
      return new Promise<ReturnType<typeof response>>(resolve => {
        finishOld = value => resolve(value as ReturnType<typeof response>)
      })
    })
    const update = vi.fn()
    const stop = watchElevateDeliveryStatus(load, update, { intervalMs: 100, requestTimeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(signals[0].aborted).toBe(true)
    expect(update.mock.calls[0][0].requestError).toBe('unavailable')
    await vi.advanceTimersByTimeAsync(100)
    expect(update.mock.calls[1][0]).toMatchObject({ state: 'completed', requestError: null })
    finishOld(kind === 'body' ? { deliveryAlignmentStatus: 'processing' }
      : response({ deliveryAlignmentStatus: 'processing' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(update).toHaveBeenCalledTimes(2)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('enforces elapsed time even while a later request is stuck', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      return signals.length === 1
        ? Promise.resolve(response({ deliveryAlignmentStatus: 'processing' }))
        : new Promise<ReturnType<typeof response>>(() => {})
    })
    const update = vi.fn()
    const stop = watchElevateDeliveryStatus(load, update, {
      intervalMs: 100, requestTimeoutMs: 1000, maxWaitMs: 250,
    })
    await vi.advanceTimersByTimeAsync(250)
    expect(signals[1].aborted).toBe(true)
    expect(update.mock.lastCall?.[0]).toMatchObject({ timedOut: true, requestError: 'unavailable' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(load).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })

  it('shows the current request failure, then clears it after recovery', async () => {
    vi.useFakeTimers()
    const load = vi.fn()
      .mockResolvedValueOnce(response({ deliveryAlignmentStatus: 'processing' }))
      .mockRejectedValueOnce(new Error('sensitive network details'))
      .mockResolvedValueOnce(response(completed()))
    const update = vi.fn()
    const stop = watchElevateDeliveryStatus(load, update)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(elevateDeliveryStatusLabel(update.mock.calls[1][0])).toContain('status could not be checked')
    expect(elevateDeliveryStatusLabel(update.mock.calls[1][0])).not.toContain('sensitive')
    await vi.advanceTimersByTimeAsync(10_000)
    const status = update.mock.calls[2][0] as ElevateDeliveryStatus
    expect(status.requestError).toBeNull()
    expect(status.ready).toBe(true)
    stop()
  })

  it.each([401, 403, 404])('explicitly reports HTTP %s and stops polling', async (code) => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValue(response(null, code))
    const update = vi.fn()
    const stop = watchElevateDeliveryStatus(load, update)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledOnce()
    expect(update.mock.calls[0][0].requestError).not.toBeNull()
    expect(elevateDeliveryStatusLabel(update.mock.calls[0][0])).toMatch(/Sign in|access|not be found/)
    stop()
  })

  it.each([
    response(null, 503),
    response(null),
    response([]),
    { ok: true, status: 200, json: async () => { throw new Error('private response') } },
    response({ deliveryAlignmentStatus: 'unexpected_technical_state' }),
  ])('shows a safe request error for bad responses', async (badResponse) => {
    vi.useFakeTimers()
    const update = vi.fn()
    const stop = watchElevateDeliveryStatus(async () => badResponse, update)
    await vi.advanceTimersByTimeAsync(0)
    expect(update.mock.calls[0][0].requestError).toBe('unavailable')
    expect(elevateDeliveryStatusLabel(update.mock.calls[0][0])).toContain('status could not be checked')
    stop()
  })

  it('reports the poll limit without claiming completion and preserves manual refresh', async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValue(response({ deliveryAlignmentStatus: 'processing' }))
    const update = vi.fn()
    const stop = watchElevateDeliveryStatus(load, update, { maxPolls: 2 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(2)
    const status = update.mock.calls[1][0] as ElevateDeliveryStatus
    expect(status.timedOut).toBe(true)
    const html = renderToStaticMarkup(<AutomaticDeliveryStatusView status={status} onRefresh={vi.fn()} />)
    expect(html).toContain('Status checks are paused')
    expect(html).toContain('Refresh status')
    expect(html).not.toContain('View updated results')
    stop()
  })

  it('ignores stale coverage and reasons when a new attempt is queued', async () => {
    vi.useFakeTimers()
    const load = vi.fn()
      .mockResolvedValueOnce(response({
        deliveryAlignmentStatus: 'retry', deliveryAlignmentError: 'alignment_timeout',
      }))
      .mockResolvedValueOnce(response({ ...completed(), deliveryAlignmentStatus: 'pending' }))
    const update = vi.fn()
    const stop = watchElevateDeliveryStatus(load, update)
    await vi.advanceTimersByTimeAsync(10_000)
    const status = update.mock.calls[1][0] as ElevateDeliveryStatus
    expect(status).toMatchObject({ state: 'pending', timing: null, reason: null, ready: false })
    expect(elevateDeliveryStatusLabel(status)).not.toMatch(/coverage|longer than expected/)
    stop()
  })

  it('aborts an in-flight request on session switch and ignores its late response', async () => {
    vi.useFakeTimers()
    let resolveOld!: (value: ReturnType<typeof response>) => void
    let oldSignal: AbortSignal | undefined
    const oldUpdate = vi.fn()
    const stopOld = watchElevateDeliveryStatus((signal) => {
      oldSignal = signal
      return new Promise((resolve) => { resolveOld = resolve })
    }, oldUpdate)
    stopOld()
    expect(oldSignal?.aborted).toBe(true)
    const newUpdate = vi.fn()
    const stopNew = watchElevateDeliveryStatus(async () => response(completed('complete', 4)), newUpdate)
    resolveOld(response(completed()))
    await vi.advanceTimersByTimeAsync(0)
    expect(oldUpdate).not.toHaveBeenCalled()
    expect(newUpdate).toHaveBeenCalledOnce()
    expect(newUpdate.mock.calls[0][0].timing.state).toBe('complete')
    stopNew()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores JSON arriving after unmount and removes scheduled polls', async () => {
    vi.useFakeTimers()
    let resolveBody!: (value: unknown) => void
    const update = vi.fn()
    const stop = watchElevateDeliveryStatus(async () => ({
      ok: true, status: 200,
      json: () => new Promise((resolve) => { resolveBody = resolve }),
    }), update)
    await vi.advanceTimersByTimeAsync(0)
    stop()
    resolveBody(completed())
    await vi.advanceTimersByTimeAsync(0)
    expect(update).not.toHaveBeenCalled()
    const load = vi.fn().mockResolvedValue(response({ deliveryAlignmentStatus: 'pending' }))
    const stopPending = watchElevateDeliveryStatus(load, update)
    await vi.advanceTimersByTimeAsync(0)
    stopPending()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(load).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
