import {
  browserJournalLocks, classifyUploadStatus, clearAccountJournal, indexedDbJournalStore, recoverRecordings,
  type JournalMeta, type RecoveryOutcome, type RecoveryUpload,
} from './recordingJournal'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'
const UPLOAD_TIMEOUT_MS = 30_000

/** The normal session-recording upload, addressed to the journal's original session and segment. */
export const recoveryUpload = (token: string | null): RecoveryUpload => async (meta: JournalMeta, blob: Blob, durationSec: number) => {
  if (!token) return 'unauthorized'
  const form = new FormData()
  form.append('audio', blob, `elevate-${meta.sessionId}.webm`)
  form.append('recordingType', 'user')
  form.append('segmentId', meta.segmentId)
  form.append('durationSec', String(durationSec))
  form.append('recordingStartedAt', meta.startedAt)
  if (meta.captureSettings) form.append('captureSettings', JSON.stringify(meta.captureSettings))
  try {
    const response = await fetch(`${API_BASE_URL}/sessions/${encodeURIComponent(meta.sessionId)}/recording/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
    return classifyUploadStatus(response.status)
  } catch {
    return 'retry' // offline or timed out: kept for the next attempt
  }
}

let running: Promise<RecoveryOutcome[]> | null = null

/** Recover this account's abandoned recordings once (concurrent calls share one run). */
export function recoverAccountRecordings(accountId: string): Promise<RecoveryOutcome[]> {
  const store = indexedDbJournalStore()
  if (!store) return Promise.resolve([])
  if (!running) {
    running = recoverRecordings({ store, locks: browserJournalLocks(), accountId, upload: recoveryUpload(localStorage.getItem('spashtai_token')) })
      .then(outcomes => {
        for (const o of outcomes) if (o.result !== 'locked') console.info(`Recording recovery: segment ${o.segmentId} ${o.result}`)
        return outcomes
      })
      .catch(error => { console.warn('Recording recovery failed:', error); return [] })
      .finally(() => { running = null })
  }
  return running
}

/** Explicit sign-out: bounded upload attempt (with the token captured before sign-out), then this account's local
 * recordings are deleted. */
export async function clearRecordingsOnSignOut(accountId: string, token: string | null): Promise<void> {
  const store = indexedDbJournalStore()
  if (!store) return
  try {
    await clearAccountJournal({ store, locks: browserJournalLocks(), accountId, upload: token ? recoveryUpload(token) : null })
  } catch (error) {
    console.warn('Could not clear local recordings on sign-out:', error)
  }
}
