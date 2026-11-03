import { describe, expect, it } from 'vitest'
import { redact, safeUrl } from '../src/redact.js'
import { assertTargetAllowed, classifyTarget } from '../src/config.js'
import { cleanSpoken, parseDecision } from '../src/candidate/brain.js'
import { planSpeech, splitPieces } from '../src/candidate/speech.js'
import { classify } from '../src/report/report.js'
import { seededRandom } from '../src/candidate/scenarios.js'
import type { Check } from '../src/adapters/types.js'

describe('redaction', () => {
  it('removes JWTs, bearer tokens, query secrets, JSON secrets and supplied secrets', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxMjM0NTY3OCJ9.c2lnbmF0dXJlLXZhbHVlLXg'
    const text = `Authorization: Bearer abcdefghijklmnop ${jwt} /stream?access_token=xyz123&x=1 {"token":"t0p","password":"hunter22"} pw=S3cretValue`
    const out = redact(text, ['S3cretValue'])
    for (const leaked of [jwt, 'abcdefghijklmnop', 'xyz123', 't0p', 'hunter22', 'S3cretValue']) expect(out).not.toContain(leaked)
  })
  it('drops query strings from URLs kept as evidence', () => {
    expect(safeUrl('http://localhost:4000/sessions/a/recording/stream?access_token=abc')).toBe('http://localhost:4000/sessions/a/recording/stream?[query]')
  })
})

describe('target guard', () => {
  it('classifies targets', () => {
    expect(classifyTarget('http://localhost:5173')).toBe('local')
    expect(classifyTarget('https://spasht.ai')).toBe('production')
    expect(classifyTarget('https://app.spasht.ai/interviews')).toBe('production')
    expect(classifyTarget('https://staging.spasht.ai', { VTC_NONPRODUCTION_HOSTS: 'staging.spasht.ai' })).toBe('remote')
    expect(classifyTarget('https://qa.example.org', { VTC_PRODUCTION_HOSTS: 'qa.example.org' })).toBe('production')
  })
  it('requires explicit opt-in for production', () => {
    expect(() => assertTargetAllowed('production', false)).toThrow(/allow-production/)
    expect(() => assertTargetAllowed('production', true)).not.toThrow()
    expect(() => assertTargetAllowed('local', false)).not.toThrow()
  })
})

describe('candidate decisions', () => {
  it('parses JSON with surrounding text and strips markup', () => {
    expect(parseDecision('Sure: {"action":"answer","text":"**Yes**, I would.","sessionComplete":false}')).toMatchObject({ action: 'answer', text: 'Yes, I would.' })
  })
  it('treats an answer without text as waiting', () => {
    expect(parseDecision('{"action":"answer","text":""}').action).toBe('wait')
  })
  it('falls back to plain text when the model ignores the format', () => {
    expect(parseDecision('I would start with the login API.')).toMatchObject({ action: 'answer', text: 'I would start with the login API.' })
  })
  it('converts [pause] markers to the hesitation marker', () => {
    expect(cleanSpoken('Um [pause] yes')).toBe('Um ... yes')
  })
  it('splits on hesitation markers only for hesitant scenarios', () => {
    expect(splitPieces('Um, so... I think… yes', true)).toEqual(['Um, so', 'I think', 'yes'])
    expect(splitPieces('Um, so... I think', false)).toEqual(['Um, so, I think'])
  })
  it('plans sentence-sized chunks with pauses only at hesitation markers', () => {
    const plan = planSpeech('First sentence is here. Second one. Third... and after a pause we finish.', true, 20)
    expect(plan).toEqual([{ say: 'First sentence is here.' }, { say: 'Second one. Third' }, { pause: true }, { say: 'and after a pause we finish.' }])
    expect(planSpeech('A. B... C.', false).some(p => 'pause' in p)).toBe(false)
  })
  it('produces reproducible delays for a seed', () => {
    const a = seededRandom(7), b = seededRandom(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})

describe('outcome classification', () => {
  const pass: Check = { name: 'x', status: 'passed', required: true, basis: 'api', detail: '' }
  const ended = { ended: true, detail: 'ok' }
  it('passes only on natural completion with all required checks passing', () => {
    expect(classify({ stop: { kind: 'natural', detail: '' }, finish: ended, checks: [pass] }).outcome).toBe('passed')
  })
  it('never reports a tool-bounded run as passed', () => {
    expect(classify({ stop: { kind: 'max_turns', detail: '' }, finish: ended, checks: [pass] }).outcome).toBe('inconclusive')
    expect(classify({ stop: { kind: 'max_duration', detail: '' }, finish: ended, checks: [pass] }).outcome).toBe('inconclusive')
  })
  it('fails on a failed required check, ignores failed advisory checks, and is inconclusive while pending', () => {
    expect(classify({ stop: { kind: 'natural', detail: '' }, finish: ended, checks: [{ ...pass, status: 'failed' }] }).outcome).toBe('failed')
    expect(classify({ stop: { kind: 'natural', detail: '' }, finish: ended, checks: [pass, { ...pass, required: false, status: 'failed' }] }).outcome).toBe('passed')
    expect(classify({ stop: { kind: 'natural', detail: '' }, finish: ended, checks: [{ ...pass, status: 'pending' }] }).outcome).toBe('inconclusive')
  })
  it('fails when the session could not be ended and reports blocked prerequisites', () => {
    expect(classify({ stop: { kind: 'natural', detail: '' }, finish: { ended: false, detail: 'x' }, checks: [pass] }).outcome).toBe('failed')
    expect(classify({ blocked: 'no auth', stop: null, finish: null, checks: [] }).outcome).toBe('blocked')
  })
})
