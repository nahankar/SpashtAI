import { cn } from '@/lib/utils'
import { practiceTitle } from '@/lib/interview-practice'

/** Practice title that never widens its container; a mixed practice lists every track behind a disclosure. */
export function PracticeTitle({ track, suffix = '', as: Tag = 'h3', className }: { track: string; suffix?: string; as?: 'h1' | 'h2' | 'h3'; className?: string }) {
  const { title, tracks } = practiceTitle(track)
  return <div className="min-w-0 max-w-full">
    {/* "Mixed practice" already names the practice; the suffix is for track titles only. */}
    <Tag className={cn('break-words', className)}>{title}{tracks.length > 2 ? '' : suffix}</Tag>
    {tracks.length > 2 && <details className="text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer hover:text-foreground">Show all {tracks.length} tracks</summary>
      <p className="mt-1 break-words">{tracks.join(', ')}</p>
    </details>}
  </div>
}
