import type { SavedAnalyticsQuery, SavedQueryList } from '@/components/admin/analytics-explorer/types'

export function pinnedQueriesDue(
  pinned: SavedAnalyticsQuery[],
  now: number,
  visible: boolean,
) {
  if (!visible) return []
  return pinned.filter((query) =>
    now - new Date(query.lastRunAt).getTime() >= query.refreshIntervalSec * 1_000,
  )
}

export function replaceSavedQuery(
  list: SavedQueryList,
  updated: SavedAnalyticsQuery,
): SavedQueryList {
  return {
    pinned: list.pinned.map((query) => query.id === updated.id ? updated : query),
    recent: list.recent.map((query) => query.id === updated.id ? updated : query),
  }
}
