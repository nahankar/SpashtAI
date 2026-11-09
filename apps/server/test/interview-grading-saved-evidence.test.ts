import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import fixture from './fixtures/interview-calibration-question-scope-focused-1.json'
import saved from './fixtures/interview-grading-saved-scope-1.json'
import { reviewCalibration, type CalibrationCase } from '../scripts/review-interview-calibration'
const review = () => reviewCalibration({ ...fixture, cases: fixture.cases as CalibrationCase[] }, saved)
describe('saved synthetic grading trial: failure evidence must not turn green', () => {
  it('replays every initial row and distinguishes passing code from a held model trial', () => {
    expect(saved.results).toHaveLength(20)
    expect(saved.results.filter(r => r.reused)).toHaveLength(2)
    expect(review()).toMatchObject({ calibrated: false, decision: 'HOLD_GRADE_DRIVEN_ADAPTATION',
      summary: { cases: 20, failedCases: 2, allRequiredChecksPass: false, allRoutingLabelsMatch: false } })
  })
  it('does not credit unresolved referents just because topic words were quoted exactly', () => {
    const row = review().reviews.find(r => r.id === 'N15-03')!
    expect(row.actual).toBe('CORRECT') // actual saved failure, not our expected grade
    expect(row.failures).toEqual(['EXPECTED_UNGRADED_REVIEW'])
  })
  it('retains both an unnecessary review and a preferred adaptive-label disagreement', () => {
    expect(review().reviews.find(r => r.id === 'P2-02')?.failures).toContain('EVALUATION_REVIEW_REQUIRED')
    expect(review().reviews.find(r => r.id === 'P2-07')).toMatchObject({
      acceptableClassification: true, exactExpected: false, failures: [],
    })
  })
  it('keeps concise correct, meaningful mixed and incidental-true/false-core controls intact', () => {
    for (const id of ['N15-01', 'N15-08', 'S1-01', 'S1-02']) {
      expect(review().reviews.find(r => r.id === id)).toMatchObject({ exactExpected: true, failures: [] })
    }
  })
  it('pins the historical expectation file instead of silently changing replay labels', () => {
    const bytes = readFileSync(new URL('./fixtures/interview-calibration-question-scope-focused-1.json', import.meta.url))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(saved.provenance.fixtureSha256)
  })
  it('commits only an explicit synthetic result projection, excluding operational evidence', () => {
    expect(saved.provenance.applicationRevision).toBe('524d4c936fce1cf2d384916332b6da85e615a957')
    for (const row of saved.results) {
      expect(Object.keys(row).sort()).toEqual(['errorCode', 'id', 'model', 'result', 'reused', 'status'])
      expect(Object.keys(row.result ?? {}).every(k => ['classification', 'responseKind', 'assessmentIssues',
        'criteria', 'strengths', 'gaps', 'misconceptions', 'guidance'].includes(k))).toBe(true)
    }
  })
})
