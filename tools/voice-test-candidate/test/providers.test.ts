import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Budget, ProviderBudgetExceeded, providerRequest } from '../src/providers/http.js'

let server: Server
let base = ''
const hits: Record<string, number> = {}

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? ''
    hits[path] = (hits[path] ?? 0) + 1
    if (path === '/slow') { setTimeout(() => res.end('{"ok":true}'), 400); return }
    if (path === '/flaky') { res.statusCode = hits[path] === 1 ? 503 : 200; res.end('{"ok":true}'); return }
    if (path === '/bad') { res.statusCode = 400; res.end('nope'); return }
    if (path === '/hang') return
    res.end('{"ok":true}')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.closeAllConnections(); server.close() })

const json = (res: Response) => res.json()

describe('providerRequest', () => {
  it('stops waiting promptly when the caller cancels, without crashing on the late response', async () => {
    const abort = new AbortController()
    const started = Date.now()
    const pending = providerRequest(new Budget('t', 5), `${base}/slow`, {}, json, { timeoutMs: 5000, signal: abort.signal })
    setTimeout(() => abort.abort(new Error('cancelled')), 50)
    await expect(pending).rejects.toThrow('cancelled')
    expect(Date.now() - started).toBeLessThan(300)
    await new Promise(r => setTimeout(r, 500))
  })

  it('retries a transient HTTP error once and counts both requests', async () => {
    const budget = new Budget('t', 5)
    await expect(providerRequest(budget, `${base}/flaky`, {}, json, { timeoutMs: 2000 })).resolves.toEqual({ ok: true })
    expect(budget.count).toBe(2)
  })

  it('does not retry client errors or timeouts', async () => {
    const budget = new Budget('t', 5)
    await expect(providerRequest(budget, `${base}/bad`, {}, json, { timeoutMs: 2000 })).rejects.toThrow(/HTTP 400/)
    await expect(providerRequest(budget, `${base}/hang`, {}, json, { timeoutMs: 150 })).rejects.toThrow()
    expect(budget.count).toBe(2)
  })

  it('refuses requests beyond the per-run limit', async () => {
    const budget = new Budget('t', 1)
    await providerRequest(budget, `${base}/ok`, {}, json, { timeoutMs: 2000 })
    await expect(providerRequest(budget, `${base}/ok`, {}, json, { timeoutMs: 2000 })).rejects.toBeInstanceOf(ProviderBudgetExceeded)
  })
})
