import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import type { RecordingAcknowledgment } from '@/lib/interview-practice'

/** One-time acknowledgment shown before a learner's first practice; the exact text and version come from the server. */
export function RecordingAcknowledgmentCard({ value, busy, error, onAccept }: { value: RecordingAcknowledgment; busy: boolean; error: string; onAccept: () => void }) {
  return <div className="space-y-3 rounded-lg border bg-muted/30 p-4" role="region" aria-label="Interviews recording notice">
    <h3 className="font-medium">Before your first interview practice</h3>
    <p className="text-sm">{value.current.text}</p>
    <p className="text-xs text-muted-foreground">You agree once for Interviews; it applies to later practices until this notice changes. See the{' '}
      <Link className="underline" to="/terms" target="_blank">Terms</Link> and <Link className="underline" to="/privacy" target="_blank">Privacy Policy</Link>.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={busy} onClick={onAccept}>{busy ? 'Saving…' : 'I agree'}</Button>
  </div>
}

/** The short recording reminder near Start once the acknowledgment is on record. */
export function RecordingNotice({ acceptedAt }: { acceptedAt: string }) {
  return <p className="text-sm text-muted-foreground">Recording: your answers are recorded, transcribed and may be evaluated by AI, as you agreed on{' '}
    {new Date(acceptedAt).toLocaleDateString()}. You can delete any practice from Interview history.</p>
}
