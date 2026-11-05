import { describe, expect, it } from 'vitest'
import { reviewCalibration, reviewCalibrationCase, type CalibrationCase, type CalibrationRow } from '../scripts/review-interview-calibration'

const test: CalibrationCase = { id: 'test', answer: 'A valid reason.', expected: 'CORRECT', expectReasoning: true }
const row: CalibrationRow = { id: 'test', model: 'policy', status: 'COMPLETED', result: { classification: 'CORRECT',
  criteria: [{ criterion: 'REASONING', finding: 'MET', evidence: ['A valid reason.'] }] } }
const review = (cases = [test], results = [row]) => reviewCalibration({ fixtureVersion: 'v', cases }, { fixtureVersion: 'v', results })

describe('grading readiness acceptance review', () => {
  it('does not count a negative reasoning finding as credit for valid reasoning', () => {
    expect(reviewCalibrationCase(test, { ...row, result: { ...row.result, criteria: [{ criterion: 'REASONING', finding: 'NOT_MET', evidence: ['A valid reason.'] }] } }).failures).toContain('VALID_REASONING_NOT_CREDITED')
  })
  it('keeps a failed or missing grade unavailable, rather than scoring it incorrect', () => {
    const result = review([test], [{ ...row, status: 'FAILED', errorCode: 'INVALID_OUTPUT_INCONSISTENT', result: null }])
    expect(result.summary.usable).toBe(0)
    expect(result.reviews[0]).toMatchObject({ actual: null, usable: false })
  })
  it('does not hide a missing result or a quotation invented by the model', () => {
    expect(review([test, { ...test, id: 'missing' }]).summary.failedCases).toBe(1)
    expect(reviewCalibrationCase(test, { ...row, result: { ...row.result, criteria: [{ criterion: 'REASONING', finding: 'MET', evidence: ['Invented.'] }] } }).failures).toContain('UNSUPPORTED_QUOTATION')
  })
  it('distinguishes permissive classification agreement from an unresolved adaptive routing label', () => {
    const result = review([{ ...test, expected: 'PARTIAL', acceptable: ['PARTIAL', 'CORRECT'] }])
    expect(result.summary).toMatchObject({ acceptableClassification: 1, exactExpected: 0, allRequiredChecksPass: true })
    expect(result.decision).toBe('HOLD_GRADE_DRIVEN_ADAPTATION')
  })
  it('requires mixed-answer strengths and rejects false reasoning credit', () => {
    expect(reviewCalibrationCase({ ...test, reasoningMustNotBeMet: true, expectStrength: ['composition'] }, row).failures).toEqual(['FALSE_OR_EMPTY_REASON_MET', 'MISSING_CORRECT_STRENGTH'])
  })
  it('requires the correct server-owned no-answer kind', () => {
    expect(reviewCalibrationCase({ ...test, expectReasoning: false, expected: 'NOT_ANSWERED', expectedKind: 'REQUEST_ONLY' }, { ...row, result: { classification: 'NOT_ANSWERED', responseKind: 'DONT_KNOW' } }).failures).toContain('RESPONSE_KIND_MISMATCH')
  })
  it('rejects mismatched fixtures, unknown results and duplicate rows', () => {
    expect(() => review([test], [{ ...row, id: 'other' }])).toThrow('Unexpected result')
    expect(() => review([test], [row, row])).toThrow('Duplicate result')
    expect(() => reviewCalibration({ fixtureVersion: 'v', cases: [test] }, { fixtureVersion: 'other', results: [row] })).toThrow('Fixture version mismatch')
  })
  it('never calls a small passing sample calibrated', () => {
    expect(review()).toMatchObject({ calibrated: false, decision: 'SAMPLE_PASSED_REVIEW_STILL_REQUIRED' })
  })
})
