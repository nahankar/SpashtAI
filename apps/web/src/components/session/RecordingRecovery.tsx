import { useEffect } from 'react'
import { recoverAccountRecordings } from '@/lib/recordingRecovery'

const RETRY_MS = 60_000

/**
 * Uploads this account's recordings that a reload, crash or failed upload left in the local journal, each to its
 * original session and segment. Runs when the signed-in page loads, when the browser comes back online, and every
 * minute; recordings still being written (or recovered by another tab) are skipped.
 */
export function RecordingRecovery({ accountId }: { accountId: string }) {
  useEffect(() => {
    const run = () => { void recoverAccountRecordings(accountId) }
    run()
    window.addEventListener('online', run)
    const timer = setInterval(run, RETRY_MS)
    return () => { window.removeEventListener('online', run); clearInterval(timer) }
  }, [accountId])
  return null
}
