import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bankFile, bankWrite } from './interview-bank'
const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset()
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'spashtai_token' ? 'test-bank-token' : null })
})
afterEach(() => vi.unstubAllGlobals())
describe('Admin bank transport boundaries', () => {
  it('uploads a file with bearer auth and the browser multipart boundary', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ headers: ['QID'] }), { status: 200 }))
    const form = new FormData(); form.append('file', new Blob(['QID\nAUTO-1']), 'bank.csv')
    expect(await bankFile('/imports/inspect', form)).toEqual({ headers: ['QID'] })
    const options = fetchMock.mock.calls[0][1]
    expect(options.headers.Authorization).toBe('Bearer test-bank-token')
    expect(options.headers['Content-Type']).toBeUndefined(); expect(options.body).toBe(form)
  })
  it('propagates cancellation so leaving the import screen can stop more work', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
    const result = bankFile('/imports/preview', new FormData(), controller.signal); controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('reports sign-in expiry instead of treating an unauthorized upload as success', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    await expect(bankFile('/imports/preview', new FormData())).rejects.toThrow('sign-in expired')
  })
  it('surfaces server validation errors and retrieves reports as blobs', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Map questionText' }), { status: 400 }))
    await expect(bankFile('/imports/preview', new FormData())).rejects.toThrow('Map questionText')
    fetchMock.mockResolvedValueOnce(new Response('"Row","Errors"', { status: 200 }))
    const result = await bankFile<Blob>('/imports/test/report'); expect(await result.text()).toContain('Errors')
  })
  it('sends the saved revision with edit requests', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await bankWrite('/versions/test', { revision: 7, draft: { questionText: 'Question?' } }, 'PUT')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ revision: 7, draft: { questionText: 'Question?' } }) })
  })
})
