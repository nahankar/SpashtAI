import { describe, expect, it } from 'vitest'
import { createPinnedRefresher, type RefreshClock } from './pinnedRefresh'

function fakeClock() {
  let now = 0
  let nextId = 1
  const queue: Array<{ id: number; at: number; fn: () => void }> = []
  const clock: RefreshClock = {
    setTimeout(fn, delayMs) {
      const id = nextId
      nextId += 1
      queue.push({ id, at: now + delayMs, fn })
      return id
    },
    clearTimeout(id) {
      const index = queue.findIndex((item) => item.id === id)
      if (index >= 0) queue.splice(index, 1)
    },
  }
  return {
    clock,
    now: () => now,
    pending: () => queue.length,
    advance(ms: number) {
      now += ms
      for (;;) {
        const due = queue
          .filter((item) => item.at <= now)
          .sort((left, right) => left.at - right.at || left.id - right.id)[0]
        if (!due) break
        const index = queue.findIndex((item) => item.id === due.id)
        if (index >= 0) queue.splice(index, 1)
        due.fn()
      }
    },
  }
}

async function flush() {
  for (let step = 0; step < 8; step += 1) await Promise.resolve()
}

describe('pinned analytics refresh', () => {
  it('waits for the default minute and does not run while the document is hidden', async () => {
    const time = fakeClock()
    let visible = false
    const runs: string[] = []
    const refresher = createPinnedRefresher({
      getQueries: () => [{ id: 'alpha' }],
      isVisible: () => visible,
      run: async (id) => {
        runs.push(id)
      },
      clock: time.clock,
    })

    refresher.sync()
    time.advance(120_000)
    await flush()
    expect(runs).toEqual([])
    expect(refresher.pendingCount()).toBe(0)

    visible = true
    refresher.sync()
    time.advance(59_000)
    await flush()
    expect(runs).toEqual([])
    time.advance(1_000)
    await flush()
    expect(runs).toEqual(['alpha'])
    expect(refresher.pendingCount()).toBe(1)
  })

  it('uses 30 second and 5 minute intervals, then schedules the next visible run', async () => {
    const time = fakeClock()
    const runs: string[] = []
    const refresher = createPinnedRefresher({
      getQueries: () => [
        { id: 'fast', refreshIntervalSec: 30 },
        { id: 'slow', refreshIntervalSec: 300 },
      ],
      isVisible: () => true,
      run: async (id) => {
        runs.push(`${id}@${time.now()}`)
      },
      clock: time.clock,
    })
    refresher.sync()
    for (let step = 0; step < 9; step += 1) {
      time.advance(30_000)
      await flush()
    }
    expect(runs).toEqual([
      'fast@30000',
      'fast@60000',
      'fast@90000',
      'fast@120000',
      'fast@150000',
      'fast@180000',
      'fast@210000',
      'fast@240000',
      'fast@270000',
    ])
    time.advance(30_000)
    await flush()
    expect(runs.slice(0, 9)).toEqual([
      'fast@30000',
      'fast@60000',
      'fast@90000',
      'fast@120000',
      'fast@150000',
      'fast@180000',
      'fast@210000',
      'fast@240000',
      'fast@270000',
    ])
    expect(runs.slice(9).sort()).toEqual(['fast@300000', 'slow@300000'])
  })

  it('aborts an in-flight run and drops timers when the document hides or the refresher stops', async () => {
    const time = fakeClock()
    let visible = true
    let signal: AbortSignal | undefined
    let release: (() => void) | undefined
    const refresher = createPinnedRefresher({
      getQueries: () => [{ id: 'alpha', refreshIntervalSec: 60 }],
      isVisible: () => visible,
      run: (_id, next) => {
        signal = next
        return new Promise((resolve) => {
          release = resolve
        })
      },
      clock: time.clock,
    })
    refresher.sync()
    time.advance(60_000)
    await flush()
    expect(signal?.aborted).toBe(false)

    visible = false
    refresher.sync()
    expect(signal?.aborted).toBe(true)
    expect(refresher.pendingCount()).toBe(0)
    release?.()
    await flush()
    expect(refresher.pendingCount()).toBe(0)

    visible = true
    refresher.sync()
    expect(refresher.pendingCount()).toBe(1)
    refresher.stop()
    expect(refresher.pendingCount()).toBe(0)
    time.advance(60_000)
    await flush()
    expect(signal?.aborted).toBe(true)
  })

  it('replaces a timer when the interval changes and removes a query that is no longer pinned', async () => {
    const time = fakeClock()
    let queries = [
      { id: 'alpha', refreshIntervalSec: 60 },
      { id: 'beta', refreshIntervalSec: 60 },
    ]
    const runs: string[] = []
    const refresher = createPinnedRefresher({
      getQueries: () => queries,
      isVisible: () => true,
      run: async (id) => {
        runs.push(id)
      },
      clock: time.clock,
    })
    refresher.sync()
    time.advance(20_000)
    queries = [{ id: 'alpha', refreshIntervalSec: 30 }]
    refresher.sync()
    expect(refresher.pendingCount()).toBe(1)
    time.advance(29_000)
    await flush()
    expect(runs).toEqual([])
    time.advance(1_000)
    await flush()
    expect(runs).toEqual(['alpha'])
  })

  it('keeps the schedule after a failed run', async () => {
    const time = fakeClock()
    let attempts = 0
    const refresher = createPinnedRefresher({
      getQueries: () => [{ id: 'alpha', refreshIntervalSec: 60 }],
      isVisible: () => true,
      run: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('temporary')
      },
      clock: time.clock,
    })
    refresher.sync()
    time.advance(60_000)
    await flush()
    time.advance(60_000)
    await flush()
    expect(attempts).toBe(2)
    expect(refresher.pendingCount()).toBe(1)
  })
})
