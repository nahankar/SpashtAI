import { refreshDelayMs } from './format'

export type PinnedRefreshQuery = {
  id: string
  refreshIntervalSec?: number | null
}

export type RefreshClock = {
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (timerId: number) => void
}

type RefresherOptions = {
  getQueries: () => PinnedRefreshQuery[]
  isVisible: () => boolean
  run: (id: string, signal: AbortSignal) => Promise<void>
  clock?: RefreshClock
}

const browserClock: RefreshClock = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (timerId) => window.clearTimeout(timerId),
}

/**
 * Arms one timer per pinned query. Timers exist only while `isVisible()` is true.
 * Hiding, stopping, or dropping a query aborts its in-flight run and clears its timer.
 * A finished run schedules the next delay from the latest query list.
 */
export function createPinnedRefresher(options: RefresherOptions) {
  const clock = options.clock ?? browserClock
  const timers = new Map<string, number>()
  const delays = new Map<string, number>()
  const controllers = new Map<string, AbortController>()
  const running = new Set<string>()
  let disposed = false

  const clearTimer = (id: string) => {
    const timerId = timers.get(id)
    if (timerId == null) return
    clock.clearTimeout(timerId)
    timers.delete(id)
    delays.delete(id)
  }

  const abortRun = (id: string) => {
    const controller = controllers.get(id)
    if (!controller) return
    controller.abort()
    controllers.delete(id)
  }

  const arm = (query: PinnedRefreshQuery) => {
    if (disposed || !options.isVisible()) return
    const delayMs = refreshDelayMs(query.refreshIntervalSec)
    clearTimer(query.id)
    const timerId = clock.setTimeout(() => {
      timers.delete(query.id)
      delays.delete(query.id)
      start(query.id)
    }, delayMs)
    timers.set(query.id, timerId)
    delays.set(query.id, delayMs)
  }

  const start = (id: string) => {
    if (disposed || !options.isVisible() || running.has(id)) return
    abortRun(id)
    const controller = new AbortController()
    controllers.set(id, controller)
    running.add(id)
    void (async () => {
      try {
        await options.run(id, controller.signal)
      } catch {
        // The page records the failure. The next visible interval still runs.
      }
      running.delete(id)
      if (controllers.get(id) === controller) controllers.delete(id)
      if (disposed || !options.isVisible()) return
      const query = options.getQueries().find((item) => item.id === id)
      if (query) arm(query)
    })()
  }

  const abortAll = () => {
    for (const id of [...controllers.keys()]) abortRun(id)
  }

  return {
    sync() {
      if (disposed) return
      const queries = options.getQueries()
      const ids = new Set(queries.map((query) => query.id))
      if (!options.isVisible()) {
        for (const id of [...timers.keys()]) clearTimer(id)
        abortAll()
        return
      }
      for (const id of [...timers.keys()]) {
        if (!ids.has(id)) clearTimer(id)
      }
      for (const id of [...controllers.keys()]) {
        if (!ids.has(id)) abortRun(id)
      }
      for (const query of queries) {
        if (running.has(query.id)) continue
        const delayMs = refreshDelayMs(query.refreshIntervalSec)
        if (timers.has(query.id) && delays.get(query.id) === delayMs) continue
        arm(query)
      }
    },
    abort(id?: string) {
      if (id) abortRun(id)
      else abortAll()
    },
    stop() {
      disposed = true
      for (const id of [...timers.keys()]) clearTimer(id)
      abortAll()
    },
    pendingCount() {
      return timers.size
    },
  }
}
