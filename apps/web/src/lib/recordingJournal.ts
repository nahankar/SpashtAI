/**
 * Refresh/crash recovery for in-browser session recordings (Elevate and Interviews share the recorder).
 *
 * The recorder already produces WebM/Opus in 1-second timeslices; each slice is appended to a local journal as it
 * arrives. Concatenating every slice of one recording in order (the first slice carries the WebM header) is the
 * same playable file the normal upload sends, and any in-order prefix is also playable. After a reload, a journal
 * that is no longer live is uploaded to its ORIGINAL session and segment through the normal, idempotent upload.
 *
 * Isolation and lifetime (see docs/prepare/INTERVIEWS-RECORDING-RECOVERY.md):
 * - Entries are keyed by account, session, segment and recording id; only the signed-in account's entries are ever
 *   read for recovery, and the server re-checks ownership.
 * - A live recorder holds a Web Lock on its key, so no other tab (or recovery in the same tab) can upload a recording
 *   that is still being written; recoveries take the same lock, so competing tabs never upload the same recording.
 * - Local data is deleted after a confirmed upload, a deliberate discard, a terminal server answer (practice deleted,
 *   segment already holds its recording, nothing playable), an explicit sign-out (after a bounded upload attempt), or
 *   expiry after 7 days.
 * - At most the current timeslice (about 1 s) plus one local write is unpersisted at the instant of a crash.
 */

export const JOURNAL_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000
export const RECORDING_BLOB_TYPE = 'audio/webm'
const DB_NAME = 'spashtai-recording-journal'
const LOCK_PREFIX = 'spashtai-recording:'
// Without Web Locks a journal is treated as abandoned only when nothing was appended for this long.
const STALE_WITHOUT_LOCKS_MS = 2 * 60 * 1000

export type JournalMeta = {
  key: string
  recordingId: string
  accountId: string
  sessionId: string
  segmentId: string
  startedAt: string
  captureSettings: unknown | null
  createdAt: number
  lastChunkAt: number
  chunkCount: number
  /** 'partial' when local storage failed part-way: the stored prefix is still playable. */
  state: 'recording' | 'closed' | 'partial'
}

export interface JournalStore {
  putMeta(meta: JournalMeta): Promise<void>
  listMeta(): Promise<JournalMeta[]>
  putChunk(key: string, seq: number, chunk: Blob): Promise<void>
  chunks(key: string): Promise<Blob[]>
  remove(key: string): Promise<void>
}

/** Web Locks, or a permissive stand-in (tests, or browsers without the API) that relies on staleness. */
export interface JournalLocks {
  supported: boolean
  /** Hold the key until the returned release is called. */
  hold(key: string): Promise<() => void>
  /** Run fn only if nobody holds the key; resolves false without running it otherwise. */
  ifFree(key: string, fn: () => Promise<void>): Promise<boolean>
}

export const journalKey = (accountId: string, sessionId: string, segmentId: string, recordingId: string) =>
  `${accountId}:${sessionId}:${segmentId}:${recordingId}`

// ---- stores --------------------------------------------------------------------------------------------------

export function memoryJournalStore(): JournalStore & { dump(): { metas: JournalMeta[]; chunks: number } } {
  const metas = new Map<string, JournalMeta>()
  const chunks = new Map<string, Map<number, Blob>>()
  return {
    async putMeta(meta) { metas.set(meta.key, { ...meta }) },
    async listMeta() { return [...metas.values()].map(m => ({ ...m })) },
    async putChunk(key, seq, chunk) { if (!chunks.has(key)) chunks.set(key, new Map()); chunks.get(key)!.set(seq, chunk) },
    async chunks(key) { return [...(chunks.get(key) ?? new Map()).entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c) },
    async remove(key) { metas.delete(key); chunks.delete(key) },
    dump() { return { metas: [...metas.values()], chunks: [...chunks.values()].reduce((n, m) => n + m.size, 0) } },
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error) })
}

let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        db.createObjectStore('recordings', { keyPath: 'key' })
        db.createObjectStore('chunks', { keyPath: ['key', 'seq'] }).createIndex('byKey', 'key')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('Recording journal database is blocked'))
    }).catch(error => { dbPromise = null; throw error })
  }
  return dbPromise
}

/** The browser journal, or null when IndexedDB is unavailable (some private modes): recording then works as before. */
export function indexedDbJournalStore(): JournalStore | null {
  if (typeof indexedDB === 'undefined') return null
  return {
    async putMeta(meta) {
      const tx = (await openDb()).transaction('recordings', 'readwrite'); tx.objectStore('recordings').put(meta); await done(tx)
    },
    async listMeta() {
      const tx = (await openDb()).transaction('recordings', 'readonly'); return request(tx.objectStore('recordings').getAll()) as Promise<JournalMeta[]>
    },
    async putChunk(key, seq, chunk) {
      const tx = (await openDb()).transaction('chunks', 'readwrite'); tx.objectStore('chunks').put({ key, seq, chunk }); await done(tx)
    },
    async chunks(key) {
      const tx = (await openDb()).transaction('chunks', 'readonly')
      const rows = await request(tx.objectStore('chunks').index('byKey').getAll(key)) as Array<{ seq: number; chunk: Blob }>
      return rows.sort((a, b) => a.seq - b.seq).map(r => r.chunk)
    },
    async remove(key) {
      const tx = (await openDb()).transaction(['recordings', 'chunks'], 'readwrite')
      tx.objectStore('recordings').delete(key)
      tx.objectStore('chunks').delete(IDBKeyRange.bound([key, -Infinity], [key, Infinity]))
      await done(tx)
    },
  }
}

export function browserJournalLocks(): JournalLocks {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks) return { supported: false, async hold() { return () => undefined }, async ifFree(_key, fn) { await fn(); return true } }
  return {
    supported: true,
    hold(key) {
      return new Promise(resolve => {
        void locks.request(LOCK_PREFIX + key, () => new Promise<void>(release => resolve(release)))
      })
    },
    async ifFree(key, fn) {
      let ran = false
      await locks.request(LOCK_PREFIX + key, { ifAvailable: true }, async lock => { if (!lock) return; ran = true; await fn() })
      return ran
    },
  }
}

// ---- live journal (one per recorder start) -------------------------------------------------------------------

export type LiveJournal = {
  append(chunk: Blob): void
  /** Wait for queued writes (used before handing the journal to recovery). */
  flush(): Promise<void>
  /** Upload confirmed or recording deliberately discarded: delete the local copy and release the lock. */
  remove(): Promise<void>
  /** Keep the local copy for recovery (upload failed or pending) and release the lock. */
  release(): Promise<void>
  healthy(): boolean
}

export async function openLiveJournal(store: JournalStore | null, locks: JournalLocks,
  init: Omit<JournalMeta, 'key' | 'createdAt' | 'lastChunkAt' | 'chunkCount' | 'state'>, now: () => number = Date.now,
  onStorageFailure: (error: unknown) => void = () => undefined): Promise<LiveJournal | null> {
  if (!store) return null
  const key = journalKey(init.accountId, init.sessionId, init.segmentId, init.recordingId)
  const releaseLock = await locks.hold(key)
  const meta: JournalMeta = { ...init, key, createdAt: now(), lastChunkAt: now(), chunkCount: 0, state: 'recording' }
  let healthy = true
  let queue: Promise<void> = Promise.resolve()
  let released = false
  const fail = (error: unknown) => {
    if (!healthy) return
    // Quota or storage failure: stop journaling; the stored prefix stays recoverable and the in-memory
    // recording and its normal upload carry on unchanged.
    healthy = false
    meta.state = 'partial'
    onStorageFailure(error)
    queue = queue.then(() => store.putMeta({ ...meta })).catch(() => undefined)
  }
  try { await store.putMeta({ ...meta }) } catch (error) { releaseLock(); onStorageFailure(error); return null }
  const finish = async (removeLocal: boolean) => {
    if (released) {
      // Released for recovery earlier (an upload failed) and uploaded or discarded later: still delete the copy.
      if (removeLocal) await store.remove(key).catch(onStorageFailure)
      return
    }
    released = true
    await queue.catch(() => undefined)
    try {
      if (removeLocal) await store.remove(key)
      else if (meta.state === 'recording') { meta.state = 'closed'; await store.putMeta({ ...meta }) }
    } catch (error) { onStorageFailure(error) } finally { releaseLock() }
  }
  return {
    append(chunk) {
      if (!healthy || released || chunk.size === 0) return
      const seq = meta.chunkCount++
      queue = queue.then(async () => {
        if (!healthy) return
        await store.putChunk(key, seq, chunk)
        meta.lastChunkAt = now()
        await store.putMeta({ ...meta })
      }).catch(fail)
    },
    flush: () => queue.catch(() => undefined),
    remove: () => finish(true),
    release: () => finish(false),
    healthy: () => healthy,
  }
}

// ---- recovery ------------------------------------------------------------------------------------------------

export type RecoveryUploadResult = 'uploaded' | 'retry' | 'gone' | 'superseded' | 'unplayable' | 'unauthorized'
export type RecoveryUpload = (meta: JournalMeta, blob: Blob, durationSec: number) => Promise<RecoveryUploadResult>
export type RecoveryOutcome = { key: string; segmentId: string; result: RecoveryUploadResult | 'expired' | 'empty' | 'locked' }

/** Results after which the local copy is no longer needed. 'retry' and 'unauthorized' keep it for a later attempt. */
const TERMINAL: RecoveryUploadResult[] = ['uploaded', 'gone', 'superseded', 'unplayable']

export async function recoverRecordings({ store, locks, accountId, upload, now = Date.now }: {
  store: JournalStore; locks: JournalLocks; accountId: string; upload: RecoveryUpload; now?: () => number
}): Promise<RecoveryOutcome[]> {
  const outcomes: RecoveryOutcome[] = []
  for (const meta of await store.listMeta()) {
    if (now() - meta.createdAt > JOURNAL_EXPIRY_MS) {
      // Expiry applies to every account's entries, so nothing lingers on a shared device indefinitely.
      const removed = await locks.ifFree(meta.key, () => store.remove(meta.key))
      outcomes.push({ key: meta.key, segmentId: meta.segmentId, result: removed ? 'expired' : 'locked' })
      continue
    }
    if (meta.accountId !== accountId) continue // never read another account's audio
    if (!locks.supported && meta.state === 'recording' && now() - meta.lastChunkAt < STALE_WITHOUT_LOCKS_MS) {
      outcomes.push({ key: meta.key, segmentId: meta.segmentId, result: 'locked' }); continue
    }
    let result: RecoveryOutcome['result'] = 'locked'
    await locks.ifFree(meta.key, async () => {
      const chunks = await store.chunks(meta.key)
      if (!chunks.some(c => c.size > 0)) { await store.remove(meta.key); result = 'empty'; return }
      const blob = new Blob(chunks, { type: RECORDING_BLOB_TYPE })
      const startedMs = Date.parse(meta.startedAt)
      const durationSec = Number.isFinite(startedMs) ? Math.max(0, (meta.lastChunkAt - startedMs) / 1000) : 0
      result = await upload(meta, blob, durationSec)
      if (TERMINAL.includes(result)) await store.remove(meta.key)
    })
    outcomes.push({ key: meta.key, segmentId: meta.segmentId, result })
  }
  return outcomes
}

/** Explicit sign-out: try to upload this account's recoverable journals (bounded), then delete all of them. */
export async function clearAccountJournal({ store, locks, accountId, upload, timeoutMs = 8000, now = Date.now }: {
  store: JournalStore; locks: JournalLocks; accountId: string; upload: RecoveryUpload | null; timeoutMs?: number; now?: () => number
}): Promise<number> {
  if (upload) {
    await Promise.race([recoverRecordings({ store, locks, accountId, upload, now }).catch(() => []),
      new Promise(resolve => setTimeout(resolve, timeoutMs))])
  }
  let removed = 0
  for (const meta of await store.listMeta()) {
    if (meta.accountId !== accountId) continue
    if (await locks.ifFree(meta.key, () => store.remove(meta.key))) removed += 1
  }
  return removed
}

/** Map the normal upload endpoint's answer to a recovery decision. */
export function classifyUploadStatus(status: number): RecoveryUploadResult {
  if (status >= 200 && status < 300) return 'uploaded'
  if (status === 404 || status === 410) return 'gone'          // practice deleted or discarded
  if (status === 409) return 'superseded'                      // the segment already holds its recording
  if (status === 400 || status === 413 || status === 422) return 'unplayable'
  if (status === 401 || status === 403) return 'unauthorized'  // keep: the owner may sign in again
  return 'retry'                                               // 408, 429, 5xx
}
