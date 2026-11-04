import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { apiOriginGuard } from '../src/browser/guard.js'
import { AppApi, BlockedError, type Check } from '../src/adapters/types.js'
import { accessItems, defaultCoverage, registrationItem, targetingItems } from '../src/preflight.js'
import { judge, sameUrl, type ComponentProvenance } from '../src/provenance.js'
import { classify } from '../src/report/report.js'
import { Evidence } from '../src/report/evidence.js'
import { settings, workflowOutcome } from '../src/workflow.js'
import { attributeStop, liveAudioChecks } from '../src/run.js'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'vtc-safety-')); dirs.push(d); return d }

/** Minimal Playwright route stand-in. */
function route(url: string) {
  const r = { aborted: false, continued: false, request: () => ({ url: () => url }), abort: async () => { r.aborted = true }, continue: async () => { r.continued = true } }
  return r
}

describe('frontend bound to another or production API', () => {
  it('refuses app API calls to a different origin than the stack API and reports the violation', async () => {
    const seen: string[] = []
    const guard = apiOriginGuard({ apiUrl: 'http://localhost:4000', targetKind: 'local' }, o => seen.push(o))
    const bad = route('https://api.spasht.ai/api/auth/me')
    await guard(bad as never)
    expect(bad.aborted).toBe(true)
    expect(seen).toEqual(['https://api.spasht.ai'])
    const other = route('http://localhost:4100/sessions/abc')
    await guard(other as never)
    expect(other.aborted).toBe(true)
    const ok = route('http://localhost:4000/api/interviews/options')
    await guard(ok as never)
    expect(ok.continued).toBe(true)
    const asset = route('https://fonts.example.com/font.woff')
    await guard(asset as never)
    expect(asset.continued).toBe(true)
  })
  it('refuses non-local API calls from a local target even without an expected API', async () => {
    const seen: string[] = []
    const r = route('https://api.spasht.ai/api/sessions')
    await apiOriginGuard({ targetKind: 'local' }, o => seen.push(o))(r as never)
    expect(r.aborted).toBe(true)
  })
  it('flags a web process configured for another API during preflight', () => {
    const stack: ComponentProvenance[] = [
      { component: 'web', pid: 1, status: 'verified', basis: '', targets: { VITE_API_BASE_URL: { value: 'https://api.spasht.ai', source: 'process environment' } } },
      { component: 'api', pid: 2, status: 'verified', basis: '', targets: { LIVEKIT_URL: { value: 'ws://localhost:7980', source: 'env' } } },
      { component: 'agent', pid: 3, status: 'verified', basis: '', targets: { SERVER_URL: { value: 'http://localhost:4100', source: 'env' } } },
    ]
    const items = targetingItems(stack, { api: 'http://localhost:4000', livekit: 'ws://localhost:7980' })
    expect(items.find(i => i.name === 'web → API binding')?.ok).toBe(false)
    expect(items.find(i => i.name === 'API → LiveKit')?.ok).toBe(true)
    expect(items.find(i => i.name.startsWith('agent pid 3'))?.ok).toBe(false)
  })
  it('blocks when several unnamed agent workers share one LiveKit', () => {
    const agent = (pid: number): ComponentProvenance => ({ component: 'agent', pid, status: 'verified', basis: '', targets: { SERVER_URL: { value: 'http://localhost:4000', source: 'env' } } })
    expect(targetingItems([agent(1), agent(2)], { api: 'http://localhost:4000', livekit: 'ws://localhost:7980' }).find(i => i.name === 'agent workers on this LiveKit')?.ok).toBe(false)
  })
  it('treats localhost and 127.0.0.1 as the same endpoint, but not different ports', () => {
    expect(sameUrl('ws://127.0.0.1:7980', 'ws://localhost:7980/')).toBe(true)
    expect(sameUrl('ws://localhost:7880', 'ws://localhost:7980')).toBe(false)
  })
})

describe('workspace scope never falls back to Personal', () => {
  function fakeApi(pageUrl: string, headers: Record<string, string> | null) {
    const listeners: Array<(req: unknown) => void> = []
    const page = { on: (_: string, fn: (req: unknown) => void) => listeners.push(fn), url: () => pageUrl, evaluate: async () => 'token' }
    const calls: string[] = []
    const context = { request: { get: async (url: string) => { calls.push(url); return { status: () => 200, ok: () => true, headers: () => ({}), body: async () => Buffer.alloc(0), json: async () => ({}) } } } }
    const api = new AppApi(page as never, context as never, 'northwind')
    if (headers) for (const fn of listeners) fn({ url: () => 'http://localhost:4000/api/x', headers: () => headers })
    else for (const fn of listeners) fn({ url: () => 'http://localhost:4000/api/x', headers: () => ({}) })
    return { api, calls }
  }
  it('refuses diagnostics when the workspace scope was never observed', async () => {
    const { api, calls } = fakeApi('http://localhost:5173/w/northwind/interviews', null)
    await expect(api.get('/api/interviews/runs')).rejects.toBeInstanceOf(BlockedError)
    expect(calls).toHaveLength(0)
  })
  it('refuses diagnostics after the page left the workspace (e.g. expired scope redirect)', async () => {
    const { api, calls } = fakeApi('http://localhost:5173/interviews', { 'x-spasht-workspace': 'scope' })
    await expect(api.getBytes('/sessions/x/recording/stream')).rejects.toBeInstanceOf(BlockedError)
    expect(calls).toHaveLength(0)
  })
})

describe('authentication and product access', () => {
  function fakeBrowser(responses: Record<string, { status: number; body?: unknown }>, token: string | null = 'token') {
    const page = { evaluate: async () => token }
    const context = { request: { get: async (url: string) => {
      const r = responses[new URL(url).pathname] ?? { status: 404 }
      return { status: () => r.status, json: async () => r.body ?? {} }
    } } }
    return { page: page as never, context: context as never }
  }
  it('blocks on a missing or rejected session', async () => {
    const none = fakeBrowser({}, null)
    expect((await accessItems(none.page, none.context, 'http://localhost:4000', ['confident-interview'], {}))[0].ok).toBe(false)
    const expired = fakeBrowser({ '/api/auth/me': { status: 401 } })
    const items = await accessItems(expired.page, expired.context, 'http://localhost:4000', ['confident-interview'], {})
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'authenticated account', ok: false })
  })
  it('blocks unavailable products, thin coverage and the wrong Interview mode', async () => {
    const b = fakeBrowser({
      '/api/auth/me': { status: 200 }, '/sessions': { status: 403 },
      '/api/interviews/options': { status: 200, body: { conversationAvailable: true, coverage: [{ track: 'Automation Testing', experienceBand: '0-2', difficulty: 'Simple', count: 1 }] } },
      '/api/interviews/runs': { status: 200, body: { runs: [] } },
    })
    const items = await accessItems(b.page, b.context, 'http://localhost:4000', ['manual-interview', 'elevate-learner'], {})
    expect(items.find(i => i.name === 'Elevate access')?.ok).toBe(false)
    expect(items.find(i => i.name === 'Interview coverage for manual-interview')?.ok).toBe(false)
    expect(items.find(i => i.name === 'Interview mode for manual-interview')?.ok).toBe(false)
  })
  it('counts the default Interview selection the way the setup page does', () => {
    expect(defaultCoverage({ coverage: [
      { track: 'Other', experienceBand: '2-5', difficulty: 'Simple', count: 9 },
      { track: 'Automation Testing', experienceBand: '0-2', difficulty: 'Simple', count: 2 },
      { track: 'Automation Testing', experienceBand: '0-2', difficulty: 'Medium', count: 3 },
      { track: 'Automation Testing', experienceBand: '2-5', difficulty: 'Medium', count: 7 },
    ] })).toEqual({ track: 'Automation Testing', band: '0-2', count: 5 })
  })
})

describe('agent registration is observed, never inferred', () => {
  const now = Date.now()
  const agent: ComponentProvenance = { component: 'agent', pid: 9, status: 'verified', basis: '', processStartedAt: new Date(now - 60_000).toISOString() }
  it('accepts a registration after the latest worker start for this LiveKit', () => {
    const log = 'starting worker\nregistered worker {"id": "AW_1", "url": "ws://localhost:7980", "region": ""}'
    expect(registrationItem(log, now, agent, 'ws://localhost:7980')).toMatchObject({ ok: true, level: 'observed-registered' })
  })
  it('rejects an old registration, another LiveKit, a later failure, or a stale log', () => {
    const old = 'starting worker\nregistered worker {"url": "ws://localhost:7980"}\nstarting worker\n'
    expect(registrationItem(old, now, agent, 'ws://localhost:7980').ok).toBe(false)
    expect(registrationItem('starting worker\nregistered worker {"url": "ws://localhost:7880"}', now, agent, 'ws://localhost:7980').ok).toBe(false)
    expect(registrationItem('starting worker\nregistered worker {"url": "ws://localhost:7980"}\nfailed to connect to livekit', now, agent, 'ws://localhost:7980').ok).toBe(false)
    expect(registrationItem('starting worker\nregistered worker {"url": "ws://localhost:7980"}', now - 3_600_000, agent, 'ws://localhost:7980').ok).toBe(false)
  })
})

describe('application provenance', () => {
  it('never verifies a dirty tree or a process older than the last HEAD movement', () => {
    expect(judge({ commit: 'abc', dirty: true, processStartedAt: '2026-11-04T06:00:00Z', headMovedAt: '2026-11-04T05:00:00Z' }).status).toBe('unverified')
    expect(judge({ commit: 'abc', dirty: false, processStartedAt: '2026-11-04T04:00:00Z', headMovedAt: '2026-11-04T05:00:00Z' }).status).toBe('unverified')
    expect(judge({ commit: undefined, dirty: false }).status).toBe('unknown')
    expect(judge({ commit: 'abc', dirty: false, processStartedAt: '2026-11-04T06:00:00Z', headMovedAt: '2026-11-04T05:00:00Z' }).status).toBe('verified')
  })
})

describe('limits, timeouts and interruption', () => {
  const base = ['--target', 'http://localhost:5173', '--api-url', 'http://localhost:4000', '--livekit-url', 'ws://localhost:7980']
  it('rejects invalid limits, production and credential-bearing endpoints, and evidence outside runs/', () => {
    const cwd = tmp()
    for (const bad of [['--max-minutes', 'NaN'], ['--max-minutes', '0'], ['--verify-timeout', '9999'], ['--run-timeout', 'Infinity']]) {
      expect(() => settings(['test', ...base, ...bad], {}, cwd)).toThrow()
    }
    expect(() => settings(['test', '--target', 'https://spasht.ai'], {}, cwd)).toThrow(/production|allow-production/)
    expect(() => settings(['test', '--target', 'http://user:pw@localhost:5173'], {}, cwd)).toThrow(/credentials/)
    expect(() => settings(['test', ...base, '--output', '/tmp/elsewhere'], {}, cwd)).toThrow(/runs directory/)
    expect(() => settings(['test', ...base, '--scenario', 'nope'], {}, cwd)).toThrow(/Unknown scenario/)
    expect(settings(['test', ...base, '--scenario', 'manual-interview'], {}, cwd).scenarios).toEqual(['manual-interview'])
  })
  it('never reports a workflow with no completed scenarios as passed', () => {
    expect(workflowOutcome(true, 'test', [])).toBe('not-passed')
    expect(workflowOutcome(false, 'test', [{ exit: 0 }])).toBe('blocked')
    expect(workflowOutcome(true, 'test', [{ exit: 0 }, { exit: 3 }])).toBe('not-passed')
    expect(workflowOutcome(true, 'preflight', [])).toBe('preflight-ready')
  })
  it('classifies a whole-run timeout as failed and an interruption as inconclusive, even after a natural end', () => {
    const pass: Check = { name: 'x', status: 'passed', required: true, basis: 'api', detail: '' }
    expect(classify({ stop: { kind: 'timeout', detail: 'exceeded' }, finish: null, checks: [pass] }).outcome).toBe('failed')
    expect(classify({ stop: { kind: 'cancelled', detail: 'SIGINT' }, finish: { ended: true, detail: '' }, checks: [pass] }).outcome).toBe('inconclusive')
  })
})

describe('failure attribution and evidence', () => {
  const turn = (n: number, voiced: number, open = true) => ({ turn: n, heard: 'q', heardUtterances: [], appSpeechEndEpoch: 0, decision: 'answer' as const, sessionCompleteHint: false,
    spoken: 'answer text', micOpenAtStart: open, micTrackVoicedMs: voiced, candidateStartEpoch: 1, candidateEndEpoch: 2, audioMeta: { durationMs: 8000 } })
  it('points SpashtAI silence at the application only when the reply demonstrably reached the app microphone track', () => {
    const eng = (voiced: number) => ({ turns: [turn(1, 6000), turn(2, voiced)], transcripts: [{ id: 'a', startEpoch: 0, endEpoch: 1, text: 'q' }] }) as never
    expect(attributeStop({ kind: 'app_silent', detail: '' }, eng(7000), null)).toBe('application')
    expect(attributeStop({ kind: 'app_silent', detail: '' }, eng(0), null)).toBe('tool')
    expect(attributeStop({ kind: 'error', detail: '' }, eng(7000), 'origin')).toBe('setup')
    expect(attributeStop({ kind: 'error', detail: '', source: 'application' }, eng(7000), null)).toBe('application')
  })
  it('fails when a spoken reply never reached the app microphone track', () => {
    const checks = liveAudioChecks({ turns: [turn(1, 6000), turn(2, 100)], transcripts: [{ id: 'a', startEpoch: 0, endEpoch: 1, text: 'q' }] } as never, 1, { kind: 'natural', detail: '' })
    const c = checks.find(c => c.name === 'candidate_speech_on_app_mic_track')!
    expect(c.status).toBe('failed')
    expect(c.detail).toMatch(/turn\(s\) 2/)
  })
  it('names the failure source in every reason and never passes with a failed attributed check', () => {
    const r = classify({ stop: { kind: 'app_silent', detail: 'no speech' }, stopSource: 'application', finish: { ended: true, detail: '' },
      checks: [{ name: 'saved_transcript_covers_spoken_replies', status: 'failed', required: true, basis: 'api', detail: 'turn 3 missing' }] })
    expect(r.outcome).toBe('failed')
    expect(r.sources).toEqual(['application'])
    expect(r.reasons.every(x => /^\[(application|tool|setup|unknown)\]/.test(x))).toBe(true)
  })
  it('a required skipped or pending check (e.g. recording content or analysis) is never a pass', () => {
    const ok: Check = { name: 'a', status: 'passed', required: true, basis: 'api', detail: '' }
    for (const status of ['skipped', 'pending'] as const) {
      expect(classify({ stop: { kind: 'natural', detail: '' }, finish: { ended: true, detail: '' }, checks: [ok, { ...ok, name: 'b', status }] }).outcome).toBe('inconclusive')
    }
    expect(classify({ stop: { kind: 'plan_complete', detail: '' }, finish: { ended: true, detail: '' }, checks: [ok] }).outcome).toBe('passed')
  })
})

describe('secret redaction and private output', () => {
  it('writes redacted, owner-only evidence', () => {
    const root = tmp()
    const ev = new Evidence(root, 'run', ['Sup3rSecretPassw0rd'], Date.now(), false)
    ev.event('tool', 'x', { header: 'Authorization: Bearer abcdefghijklmnopqrstu', password: 'Sup3rSecretPassw0rd', url: 'http://localhost/s?access_token=zzz123' })
    ev.writeJson('a.json', { token: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4eHh4eHh4eCJ9.c2lnbmF0dXJleHh4eA' })
    ev.writeText('b.txt', 'cookie: session=abc; pw Sup3rSecretPassw0rd')
    writeFileSync(join(ev.dir, 'screenshot.png'), 'png', { mode: 0o644 })
    ev.lockDown()
    const files = (d: string): string[] => readdirSync(d).flatMap(n => statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)])
    const all = files(ev.dir)
    const text = all.map(f => readFileSync(f, 'utf8')).join('\n')
    for (const leaked of ['Sup3rSecretPassw0rd', 'abcdefghijklmnopqrstu', 'zzz123', 'eyJhbGciOiJIUzI1NiJ9', 'session=abc']) expect(text).not.toContain(leaked)
    for (const f of all) expect(statSync(f).mode & 0o077).toBe(0)
    expect(statSync(ev.dir).mode & 0o077).toBe(0)
  })
  it('keeps credentials, sessions and evidence out of Git', () => {
    const tool = join(import.meta.dirname, '..')
    for (const path of ['.env.local', '.auth/x.json', 'runs/r/report.md', 'node_modules/x']) {
      expect(() => execFileSync('git', ['-C', tool, 'check-ignore', '-q', path])).not.toThrow()
    }
  })
})
