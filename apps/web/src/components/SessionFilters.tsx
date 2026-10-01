import { Search, ArrowUpDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type SortField = 'date' | 'name' | 'score' | 'status' | 'duration'
export type SortDir = 'asc' | 'desc'

interface SessionFiltersProps {
  search: string
  onSearchChange: (v: string) => void
  userSearch?: string
  onUserSearchChange?: (v: string) => void
  sortField: SortField
  sortDir: SortDir
  onSortChange: (field: SortField, dir: SortDir) => void
  sortOptions: { value: SortField; label: string }[]
  statusFilter: string
  onStatusFilterChange: (v: string) => void
  statusOptions: { value: string; label: string }[]
  totalCount: number
  filteredCount: number
  searchPlaceholder?: string
  userSearchPlaceholder?: string
}

export function SessionFilters({
  search,
  onSearchChange,
  userSearch,
  onUserSearchChange,
  sortField,
  sortDir,
  onSortChange,
  sortOptions,
  statusFilter,
  onStatusFilterChange,
  statusOptions,
  totalCount,
  filteredCount,
  searchPlaceholder = 'Search sessions...',
  userSearchPlaceholder = 'Filter by user name...',
}: SessionFiltersProps) {
  const hasUserFilter = userSearch !== undefined && onUserSearchChange !== undefined
  const hasActiveFilters = search || userSearch || statusFilter !== 'all'

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
      {/* Search */}
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {search && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {hasUserFilter && (
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            aria-label="Filter by user name"
            placeholder={userSearchPlaceholder}
            value={userSearch}
            onChange={(e) => onUserSearchChange(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background py-2 pl-9 pr-8 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {userSearch && (
            <button
              type="button"
              aria-label="Clear user name filter"
              onClick={() => onUserSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Status filter */}
      <select
        value={statusFilter}
        onChange={(e) => onStatusFilterChange(e.target.value)}
        className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {statusOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Sort */}
      <div className="flex items-center gap-1">
        <select
          value={sortField}
          onChange={(e) => onSortChange(e.target.value as SortField, sortDir)}
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0"
          onClick={() => onSortChange(sortField, sortDir === 'asc' ? 'desc' : 'asc')}
          title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
        >
          <ArrowUpDown className="h-4 w-4" />
        </Button>
      </div>

      {/* Clear + count */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {filteredCount} of {totalCount}
          </span>
          <button
            onClick={() => {
              onSearchChange('')
              onUserSearchChange?.('')
              onStatusFilterChange('all')
            }}
            className="underline hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
