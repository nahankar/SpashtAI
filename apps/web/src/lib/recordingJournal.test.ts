import { describe, expect, it, vi } from 'vitest'
import {
  JOURNAL_EXPIRY_MS, classifyUploadStatus, clearAccountJournal, journalKey, memoryJournalStore, openLiveJournal, recoverRecordings,
  type JournalLocks, type JournalStore, type RecoveryUpload,
} from './recordingJournal'

/** Web Locks semantics: a held key is exclusive until released; ifFree never waits. */
function fakeLocks(): JournalLocks & { held: Set<string> } {
  const held = new Set<string>()
  return {
    supported: true, held,
    async hold(key) { held.add(key); return () => held.delete(key) },
    async ifFree(key, fn) { if (held.has(key)) return false; held.add(key); try { await fn() } finally { held.delete(key) } return true },
  }
}
const chunk = (text: string) => new Blob([text])
const T0 = Date.now()
const init = (accountId = 'acct-a', segmentId = 'seg-1', recordingId = 'rec-1') =>
  ({ recordingId, accountId, sessionId: 'session-1', segmentId, startedAt: new Date(T0).toISOString(), captureSettings: { sampleRate: 48000 } })
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
async function blobText(blob: Blob) { return new TextDecoder().decode(await blob.arrayBuffer()) }

async function recordAndCrash(store: JournalStore, locks: ReturnType<typeof fakeLocks>, parts: string[], over = {}) {
  let clock = T0
  const journal = (await openLiveJournal(store, locks, { ...init(), ...over }, () => (clock += 1000)))!
  for (const p of parts) journal.append(chunk(p))
  await journal.flush()
  // A crash or refresh: the tab (and its lock) disappears without remove() or release().
  for (const k of [...locks.held]) locks.held.delete(k)
  return journal
}

describe('recording journal', () => {
  it('journals every timeslice in order and reconstructs the same bytes the normal upload would send', async () => {
    const store = memoryJournalStore(); const locks = fakeLocks()
    await recordAndCrash(store, locks, ['HEADER', '-c1', '-c2'])
    const uploads: Array<{ segmentId: string; sessionId: string; text: string; type: string; durationSec: number }> = []
    const upload: RecoveryUpload = async (meta, blob, durationSec) => {
      uploads.push({ segmentId: meta.segmentId, sessionId: meta.sessionId, text: await blobText(blob), type: blob.type, durationSec }); return 'uploaded'
    }
    const outcomes = await recoverRecordings({ store, locks, accountId: 'acct-a', upload })
    expect(outcomes.map(o => o.result)).toEqual(['uploaded'])
    // To the ORIGINAL session and segment, never a new one; header first, then clusters.
    expect(uploads).toEqual([{ segmentId: 'seg-1', sessionId: 'session-1', text: 'HEADER-c1-c2', type: 'audio/webm', durationSec: expect.any(Number) }])
    expect(uploads[0].durationSec).toBeGreaterThan(0)
    expect(store.dump()).toEqual({ metas: [], chunks: 0 })               // deleted only after the confirmed upload
    // Repeated recovery finds nothing left to upload.
    expect(await recoverRecordings({ store, locks, accountId: 'acct-a', upload })).toEqual([])
  })

  it('never recovers a recording that is still live in some tab, and competing tabs upload it once', async () => {
    const store = memoryJournalStore(); const locks = fakeLocks()
    const live = (await openLiveJournal(store, locks, init()))!
    live.append(chunk('HEADER')); await live.flush()
    const upload = vi.fn<RecoveryUpload>(async () => 'uploaded')
    expect((await recoverRecordings({ store, locks, accountId: 'acct-a', upload }))[0].result).toBe('locked')
    expect(upload).not.toHaveBeenCalled()
    await live.release()                                                  // the live tab gave up (upload failed)
    let releaseFirst: () => void = () => undefined
    const slow: RecoveryUpload = () => new Promise(resolve => { releaseFirst = () => resolve('uploaded') })
    const first = recoverRecordings({ store, locks, accountId: 'acct-a', upload: slow })
    await flush()
    const second = await recoverRecordings({ store, locks, accountId: 'acct-a', upload })
    expect(second[0].result).toBe('locked')                               // the other tab holds the recovery
    releaseFirst(); expect((await first)[0].result).toBe('uploaded')
    expect(upload).not.toHaveBeenCalled()
  })

  it('keeps audio across failed or offline uploads and retries it idempotently later', async () => {
    const store = memoryJournalStore(); const locks = fakeLocks()
    await recordAndCrash(store, locks, ['HEADER', '-c1'])
    const results = ['retry', 'unauthorized', 'uploaded'] as const
    const seen: string[] = []
    const upload: RecoveryUpload = async (_m, blob) => { seen.push(await blobText(blob)); return results[seen.length - 1] }
    for (let i = 0; i < 3; i++) await recoverRecordings({ store, locks, accountId: 'acct-a', upload })
    expect(seen).toEqual(['HEADER-c1', 'HEADER-c1', 'HEADER-c1'])          // the same payload each time
    expect(store.dump().metas).toHaveLength(0)
  })

  it('drops the local copy after terminal answers: practice deleted, segment already recorded, nothing playable', async () => {
    for (const terminal of ['gone', 'superseded', 'unplayable'] as const) {
      const store = memoryJournalStore(); const locks = fakeLocks()
      await recordAndCrash(store, locks, ['HEADER'])
      await recoverRecordings({ store, locks, accountId: 'acct-a', upload: async () => terminal })
      expect(store.dump().metas).toHaveLength(0)
    }
    expect([200, 404, 410, 409, 422, 413, 400, 401, 403, 408, 429, 500, 503].map(classifyUploadStatus)).toEqual(
      ['uploaded', 'gone', 'gone', 'superseded', 'unplayable', 'unplayable', 'unplayable', 'unauthorized', 'unauthorized', 'retry', 'retry', 'retry', 'retry'])
  })

  it('isolates accounts: another account never reads, uploads or deletes it, except on expiry', async () => {
    const store = memoryJournalStore(); const locks = fakeLocks()
    await recordAndCrash(store, locks, ['A-audio'])
    const upload = vi.fn<RecoveryUpload>(async () => 'uploaded')
    expect(await recoverRecordings({ store, locks, accountId: 'acct-b', upload })).toEqual([])
    expect(upload).not.toHaveBeenCalled()
    expect(await clearAccountJournal({ store, locks, accountId: 'acct-b', upload })).toBe(0)
    expect(store.dump().metas).toHaveLength(1)
    // Expiry removes it whoever is signed in, so nothing lingers on a shared device indefinitely.
    const later = Date.now() + JOURNAL_EXPIRY_MS + 60_000
    expect((await recoverRecordings({ store, locks, accountId: 'acct-b', upload, now: () => later }))[0].result).toBe('expired')
    expect(upload).not.toHaveBeenCalled(); expect(store.dump().metas).toHaveLength(0)
  })

  it('sign-out tries to upload, then deletes only that account’s recordings and never a live one', async () => {
    const store = memoryJournalStore(); const locks = fakeLocks()
    await recordAndCrash(store, locks, ['A1'], { recordingId: 'a1' })
    await recordAndCrash(store, locks, ['B1'], { accountId: 'acct-b', recordingId: 'b1' })
    const live = (await openLiveJournal(store, locks, init('acct-a', 'seg-2', 'live')))!
    const upload = vi.fn<RecoveryUpload>(async () => 'retry')            // offline at sign-out
    expect(await clearAccountJournal({ store, locks, accountId: 'acct-a', upload, timeoutMs: 50 })).toBe(1)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(store.dump().metas.map(m => m.key).sort()).toEqual([journalKey('acct-a', 'session-1', 'seg-2', 'live'), journalKey('acct-b', 'session-1', 'seg-1', 'b1')].sort())
    await live.remove()
  })

  it('discard or a confirmed upload deletes it, even after it was released for recovery', async () => {
    const store = memoryJournalStore(); const locks = fakeLocks()
    const journal = (await openLiveJournal(store, locks, init()))!
    journal.append(chunk('HEADER')); await journal.release()
    expect(store.dump().metas[0].state).toBe('closed')
    await journal.remove()
    expect(store.dump()).toEqual({ metas: [], chunks: 0 })
  })

  it('a storage failure stops journaling but keeps the playable prefix, and recording carries on', async () => {
    const base = memoryJournalStore(); const locks = fakeLocks()
    let writes = 0
    const store: JournalStore = { ...base, async putChunk(key, seq, blob) { if (++writes > 2) throw new DOMException('full', 'QuotaExceededError'); return base.putChunk(key, seq, blob) } }
    const failures: unknown[] = []
    const journal = (await openLiveJournal(store, locks, init(), Date.now, e => failures.push(e)))!
    for (const p of ['HEADER', '-c1', '-c2', '-c3']) journal.append(chunk(p))
    await journal.flush(); await journal.release()
    expect(journal.healthy()).toBe(false); expect(failures).toHaveLength(1)
    expect(base.dump().metas[0].state).toBe('partial')
    const seen: string[] = []
    await recoverRecordings({ store, locks, accountId: 'acct-a', upload: async (_m, b) => { seen.push(await blobText(b)); return 'uploaded' } })
    expect(seen).toEqual(['HEADER-c1'])
  })

  it('without IndexedDB there is no journal and nothing else changes', async () => {
    expect(await openLiveJournal(null, fakeLocks(), init())).toBeNull()
  })
})
