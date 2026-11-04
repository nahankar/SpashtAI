import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { providerConfig, type RunConfig } from '../src/config.js'
import { runSession } from '../src/run.js'

let server: Server
let target = ''
const dir = mkdtempSync(join(tmpdir(), 'vtc-bounds-'))

beforeAll(async () => {
  // Accepts connections and never answers: setup hangs exactly like an unresponsive app.
  server = createServer(() => undefined)
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  target = `http://localhost:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.closeAllConnections(); server.close(); rmSync(dir, { recursive: true, force: true }) })

it('ends a hung run at the whole-run bound, writes a report and never passes', async () => {
  const authFile = join(dir, 'auth.json')
  writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }))
  const providers = providerConfig({ VTC_STT_PROVIDER: 'none', VTC_LLM_PROVIDER: 'scripted', VTC_TTS_PROVIDER: 'macos-say' })
  const cfg: RunConfig = {
    targetUrl: target, targetKind: 'local', experience: 'interview', scenario: 'confident-interview', profile: 'qa-engineer', authFile,
    headed: false, muteSpeakers: true, maxDurationMs: 60_000, maxTurns: 3, outputDir: join(dir, 'runs'), trace: false, traceFull: false, video: false,
    seed: 1, interviewMinutes: 5, elevateFocus: 'clarity', closeUnfinished: false, verifyTimeoutMs: 1000, providers, runTimeoutMs: 4000,
  }
  const started = Date.now()
  const report = await runSession(cfg)
  expect(Date.now() - started).toBeLessThan(25_000)
  expect(report.outcome).toBe('failed')
  expect(report.outcomeReasons.join(' ')).toMatch(/whole-run timeout/)
  expect(report.stop?.kind).toBe('timeout')
}, 40_000)
