import { useCallback, useEffect, useRef } from 'react'
import { refreshDelayMs } from './format'
import { createPinnedRefresher, type PinnedRefreshQuery } from './pinnedRefresh'

export function usePinnedAutoRefresh(
  queries: PinnedRefreshQuery[],
  run: (id: string, signal: AbortSignal) => Promise<void>,
) {
  const queriesRef = useRef(queries)
  const runRef = useRef(run)
  queriesRef.current = queries
  runRef.current = run
  const abortRef = useRef<(id?: string) => void>(() => {})
  const signature = queries.map((query) => `${query.id}:${refreshDelayMs(query.refreshIntervalSec)}`).join('|')

  useEffect(() => {
    const refresher = createPinnedRefresher({
      getQueries: () => queriesRef.current,
      isVisible: () => document.visibilityState === 'visible',
      run: (id, signal) => runRef.current(id, signal),
    })
    abortRef.current = (id?: string) => refresher.abort(id)
    refresher.sync()
    const onVisibility = () => refresher.sync()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      refresher.stop()
      abortRef.current = () => {}
    }
  }, [signature])

  return useCallback((id?: string) => {
    abortRef.current(id)
  }, [])
}
