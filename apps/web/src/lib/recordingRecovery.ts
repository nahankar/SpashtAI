import {
  browserJournalLocks, classifyUploadStatus, clearAccountJournal, indexedDbJournalStore, recoverRecordings, recordingRecoveryEnabled,
  type RecoveryOutcome, type RecoveryUpload,
} from './recordingJournal'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'
const TOKEN_KEY = 'spashtai_token'
const UPLOAD_TIMEOUT_MS = 30_000

type RecoveryIdentity = {
  accountId: string
  token: string
  /** Rechecked after awaits: signing out or changing identity cancels further network work. */
  stillCurrent: () => boolean
}

/** Resolve fresh access to the ORIGINAL organization. Never mutate the UI workspace or persist its token. */
export function recoveryUpload(identity: RecoveryIdentity, request: typeof fetch = fetch): RecoveryUpload {
  let verified: Promise<boolean> | null = null
  const verifyIdentity = () => verified ??= request(`${API_BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${identity.token}` }, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  }).then(async response => response.ok && (await response.json() as { user?: { id?: string } }).user?.id === identity.accountId)
  return async (meta, blob, durationSec) => {
    if (meta.accountId !== identity.accountId || !identity.stillCurrent()) return 'unauthorized'
    // Pre-workspace journals have ambiguous ownership context. Keep until expiry rather than guess Personal.
    if (meta.workspace === undefined) return 'unauthorized'
    const headers: Record<string, string> = { Authorization: `Bearer ${identity.token}` }
    try {
      // UI account state can lag a token change in another tab. Verify before treating a 404 as deletion.
      if (!await verifyIdentity() || !identity.stillCurrent()) return 'unauthorized'
      if (meta.workspace) {
        const entry = await request(`${API_BASE_URL}/api/workspaces/entry/${encodeURIComponent(meta.workspace.slug)}`, {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        })
        if (!entry.ok) return entry.status >= 500 || entry.status === 429 ? 'retry' : 'unauthorized'
        const body = await entry.json() as { workspace?: { id?: string; kind?: string }; accessToken?: string | null }
        if (body.workspace?.id !== meta.workspace.id || body.workspace.kind !== 'ORGANIZATION' || !body.accessToken) return 'unauthorized'
        headers['x-spasht-workspace'] = body.accessToken
      }
      if (!identity.stillCurrent()) return 'unauthorized'
      const form = new FormData()
      form.append('audio', blob, `elevate-${meta.sessionId}.webm`)
      form.append('recordingType', 'user')
      form.append('segmentId', meta.segmentId)
      form.append('durationSec', String(durationSec))
      form.append('recordingStartedAt', meta.startedAt)
      if (meta.captureSettings) form.append('captureSettings', JSON.stringify(meta.captureSettings))
      const response = await request(`${API_BASE_URL}/sessions/${encodeURIComponent(meta.sessionId)}/recording/upload`, {
        method: 'POST', headers, body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      })
      return classifyUploadStatus(response.status)
    } catch { return 'retry' }
  }
}

// Distinct identity generations must never inherit an earlier account/token's recovery run.
const running = new Map<string, { token: string; task: Promise<RecoveryOutcome[]> }>()

export function recoverAccountRecordings(accountId: string): Promise<RecoveryOutcome[]> {
  if (!recordingRecoveryEnabled()) return Promise.resolve([])
  const store = indexedDbJournalStore()
  const token = localStorage.getItem(TOKEN_KEY)
  if (!store || !token) return Promise.resolve([])
  const existing = running.get(accountId)
  if (existing?.token === token) return existing.task
  const identity = { accountId, token, stillCurrent: () => localStorage.getItem(TOKEN_KEY) === token }
  const task = recoverRecordings({ store, locks: browserJournalLocks(), accountId, upload: recoveryUpload(identity) })
    .catch(() => { console.warn('Local recording recovery unavailable; it will retry later'); return [] })
    .finally(() => { if (running.get(accountId)?.task === task) running.delete(accountId) })
  running.set(accountId, { token, task })
  return task
}

/** Sign-out deletes abandoned local audio; no background uploads are initiated with a logged-out identity. */
export async function clearRecordingsOnSignOut(accountId: string): Promise<void> {
  const store = indexedDbJournalStore()
  if (!store) return
  try { await clearAccountJournal({ store, locks: browserJournalLocks(), accountId, upload: null }) }
  catch { console.warn('Could not clear local recording recovery data') }
}
