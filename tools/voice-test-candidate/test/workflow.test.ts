import { describe, expect, it } from 'vitest'
import { boundedNumber, productUrl } from '../src/config.js'
import { classify } from '../src/report/report.js'
import { redact } from '../src/redact.js'

describe('workflow safety', () => {
  it('keeps all navigation in the selected workspace, including playback queries', () => {
    expect(productUrl({ targetUrl: 'http://localhost:5273', workspace: 'northwind' }, '/interviews?run=one'))
      .toBe('http://localhost:5273/w/northwind/interviews?run=one')
    expect(productUrl({ targetUrl: 'http://localhost:5273' }, '/elevate')).toBe('http://localhost:5273/elevate')
    expect(() => productUrl({ targetUrl: 'http://localhost', workspace: '../admin' }, '/elevate')).toThrow()
    expect(() => productUrl({ targetUrl: 'http://localhost' }, '//spasht.ai')).toThrow()
  })
  it('refuses nonfinite and unbounded conversation limits', () => {
    for (const value of ['NaN', 'Infinity', '-1', '10000']) expect(() => boundedNumber(value, 'minutes', 0.1, 30)).toThrow()
    expect(boundedNumber('5', 'minutes', 0.1, 30)).toBe(5)
  })
  it('cannot call missing evidence a pass', () => {
    expect(classify({ stop: null, finish: null, checks: [] }).outcome).toBe('inconclusive')
    expect(classify({ stop: { kind: 'natural', detail: '' }, finish: { ended: true, detail: '' },
      checks: [{ name: 'recording', status: 'skipped', required: true, basis: 'api', detail: '' }] }).outcome).toBe('inconclusive')
  })
  it('redacts workspace headers and media tickets, including non-JWT values', () => {
    expect(redact('x-spasht-workspace: PRIVATE_WORKSPACE_HEADER\nx-spasht-workspace-scope: PRIVATE_SCOPE\nhttp://localhost/stream?workspace_media=PRIVATE_TICKET'))
      .not.toMatch(/PRIVATE/)
  })
})
