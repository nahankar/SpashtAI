import { describe, it, expect } from 'vitest'
import contrasts from './fixtures/interview-calibration-ambiguity-contrasts-1.json'
import initial from './fixtures/interview-calibration-ambiguity-baseline-1.json'
import repeat from './fixtures/interview-calibration-ambiguity-repeat-1.json'
import original from './fixtures/interview-calibration-question-scope-focused-1.json'
import { diagnosticPlan, loadDiagnosticPlan } from '../scripts/plan-interview-diagnostic'
describe('bounded unchanged-model ambiguity diagnostic plan', () => {
  it('plans twelve calls without authorizing or claiming a model result', async () => {
    expect(diagnosticPlan(initial, repeat, original, contrasts)).toMatchObject({ status: 'OFFLINE_DEFINITION_ONLY',
      callsAuthorized: false, paidCallsProposed: 12, initialTrials: 9, freshRepeats: 3, release: 'HOLD', maximumConfiguredOutputTokens: 180000 })
    expect((await loadDiagnosticPlan()).fixtures.every(f => /^[a-f0-9]{64}$/.test(f.sha256))).toBe(true)
  })
  it('rejects changed historical expectations instead of improving scores by relabelling', () => {
    const changed = structuredClone(initial)
    changed.cases.find(c => c.id === 'N15-03')!.expected = 'CORRECT'
    expect(() => diagnosticPlan(changed, repeat, original, contrasts)).toThrow('Historical control/repeat changed')
  })
  it('rejects a changed new answer instead of silently drifting the diagnostic', () => {
    const changed = structuredClone(initial); changed.cases[0].answer += ' Extra.'
    expect(() => diagnosticPlan(changed, repeat, original, contrasts)).toThrow('New contrast cases changed')
  })
  it('rejects altered repeat answers, pins, duplicate IDs and extra calls', () => {
    const changed = structuredClone(repeat); changed.cases[0].answer += ' Extra.'
    expect(() => diagnosticPlan(initial, changed, original, contrasts)).toThrow('Historical control/repeat changed')
    const badPin = structuredClone(initial); badPin.questions['DE-NEW-001'].revision++
    expect(() => diagnosticPlan(badPin, repeat, original, contrasts)).toThrow('Question pin mismatch')
    expect(() => diagnosticPlan({ ...initial, cases: [...initial.cases, initial.cases[0]] }, repeat, original, contrasts)).toThrow('Duplicate diagnostic case')
    expect(() => diagnosticPlan({ ...initial, cases: initial.cases.slice(1) }, repeat, original, contrasts)).toThrow('New contrast cases changed')
  })
})
