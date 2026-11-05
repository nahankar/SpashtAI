import { describe, expect, it, vi } from 'vitest'
import { recoveryUpload } from './recordingRecovery'
import { journalKey, memoryJournalStore, openLiveJournal, recoverRecordings, type JournalLocks, type JournalMeta } from './recordingJournal'

const org = { id: 'northwind-id', slug: 'northwind' }
const meta = (workspace: JournalMeta['workspace'] = org): JournalMeta => ({
  key: 'key', accountId: 'learner', workspace, sessionId: 'original-session', segmentId: 'original-segment', recordingId: 'recording',
  startedAt: '2026-11-05T00:00:00Z', captureSettings: null, createdAt: 1, lastChunkAt: 1001, chunkCount: 1, state: 'closed',
})
const identity = () => ({ accountId: 'learner', token: 'private-identity', stillCurrent: () => true })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const entry = () => response({ workspace: { id: org.id, kind: 'ORGANIZATION' }, accessToken: 'fresh-workspace-access' })
const upload = (context: Parameters<typeof recoveryUpload>[0], request: typeof fetch) => recoveryUpload(context,
  async (input, options) => String(input).endsWith('/api/auth/me') ? response({ user: { id: context.accountId } }) : request(input, options))
const audio = new Blob(['audio'], { type: 'audio/webm' })

describe('workspace-safe recording recovery', () => {
  it('renews access to the original workspace and uploads only to its original session and segment', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(entry()).mockResolvedValueOnce(response({ recording: 'saved' }, 201))
    expect(await upload(identity(), request)(meta(), audio, 1)).toBe('uploaded')
    expect(request.mock.calls[0][0]).toMatch(/\/api\/workspaces\/entry\/northwind$/)
    expect(request.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer private-identity', 'Content-Type': 'application/json' })
    const [url, options] = request.mock.calls[1]
    expect(url).toMatch(/\/sessions\/original-session\/recording\/upload$/)
    expect(options?.headers).toEqual({ Authorization: 'Bearer private-identity', 'x-spasht-workspace': 'fresh-workspace-access' })
    expect((options?.body as FormData).get('segmentId')).toBe('original-segment')
    expect(JSON.stringify(meta())).not.toContain('private-identity')
    expect(JSON.stringify(meta())).not.toContain('fresh-workspace-access')
  })


  it('refuses a token for another account even when the UI still has the old account', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ user: { id: 'other-account' } }))
    expect(await recoveryUpload(identity(), request)(meta(null), audio, 1)).toBe('unauthorized')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toMatch(/\/api\/auth\/me$/)
  })

  it('recovers Personal explicitly with identity only, independent of the currently selected workspace', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({}))
    expect(await upload(identity(), request)(meta(null), audio, 1)).toBe('uploaded')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer private-identity' })
  })

  it.each([401, 403, 404, 503])('does not fall back to Personal after workspace entry returns %s', async status => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({}, status))
    expect(await upload(identity(), request)(meta(), audio, 1)).toBe(status === 503 ? 'retry' : 'unauthorized')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each([
    { workspace: { id: 'brightpath-id', kind: 'ORGANIZATION' }, accessToken: 'wrong' },
    { workspace: { id: org.id, kind: 'PERSONAL' }, accessToken: 'wrong' },
    { workspace: { id: org.id, kind: 'ORGANIZATION' }, accessToken: null },
  ])('refuses changed workspace identity or pending membership', async body => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(body))
    expect(await upload(identity(), request)(meta(), audio, 1)).toBe('unauthorized')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('stops before upload when identity changes while renewing workspace access', async () => {
    let current = true
    const request = vi.fn<typeof fetch>().mockImplementation(async () => { current = false; return entry() })
    expect(await upload({ ...identity(), stillCurrent: () => current }, request)(meta(), audio, 1)).toBe('unauthorized')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not send another account or an ambiguous pre-workspace journal', async () => {
    const request = vi.fn<typeof fetch>()
    expect(await upload({ ...identity(), accountId: 'someone-else' }, request)(meta(), audio, 1)).toBe('unauthorized')
    expect(await upload(identity(), request)({ ...meta(), workspace: undefined } as unknown as JournalMeta, audio, 1)).toBe('unauthorized')
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps denied organization audio for retry and keeps workspace keys distinct', async () => {
    const store = memoryJournalStore()
    const locks: JournalLocks = { supported: true, async hold() { return () => {} }, async ifFree(_key, work) { await work(); return true } }
    const init = meta()
    const live = (await openLiveJournal(store, locks, init))!
    live.append(audio); await live.release()
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({}, 403))
    await recoverRecordings({ store, locks, accountId: 'learner', upload: upload(identity(), request) })
    expect(store.dump().metas).toHaveLength(1)
    expect(journalKey('learner', 's', 'g', 'r', org)).not.toBe(journalKey('learner', 's', 'g', 'r', null))
  })
})
