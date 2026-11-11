import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import focused from './fixtures/interview-calibration-thinking-medium-focused-1.json'
import repeat from './fixtures/interview-calibration-thinking-medium-repeat-1.json'
import initial from './fixtures/interview-grading-saved-thinking-medium-focused-1.json'
import repeated from './fixtures/interview-grading-saved-thinking-medium-repeat-1.json'
import { reviewCalibration, type CalibrationCase } from '../scripts/review-interview-calibration'
const low = 'learner-evaluation-16', medium = 'learner-evaluation-16-thinking-medium'
const firstReview = () => reviewCalibration({ ...focused, cases: focused.cases as CalibrationCase[] }, initial)
const repeatReview = () => reviewCalibration({ ...repeat, cases: repeat.cases as CalibrationCase[] }, repeated)
describe('saved matched LOW/MEDIUM evidence, not a fresh model test', () => {
  it('retains all sixteen fresh trials and rejects both arms under the frozen checks', () => {
    expect([...initial.results, ...repeated.results]).toHaveLength(16)
    expect([...initial.results, ...repeated.results].every(r => !r.reused)).toBe(true)
    expect(firstReview().decision).toBe('HOLD_GRADE_DRIVEN_ADAPTATION')
    expect(repeatReview().decision).toBe('HOLD_GRADE_DRIVEN_ADAPTATION')
    for (const arm of [low, medium]) {
      const rows = [...firstReview().reviews, ...repeatReview().reviews].filter(r => r.model === arm)
      expect(rows).toHaveLength(8)
      expect(rows.filter(r => !r.failures.length && (r.usable || ('reviewRequiredMatched' in r && r.reviewRequiredMatched)))).toHaveLength(3)
    }
  })
  it('does not count a repeated MEDIUM invalid output as successful uncertainty handling', () => {
    for (const report of [initial, repeated]) {
      expect(report.results.find(r => r.id === 'B1-03' && r.model === medium)).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_OUTPUT_INCONSISTENT', result: null })
    }
    expect(firstReview().reviews.find(r => r.id === 'B1-03' && r.model === low)).toMatchObject({ actual: 'PARTIAL', failures: ['EXPECTED_UNGRADED_REVIEW'] })
    expect(repeatReview().reviews.find(r => r.id === 'B1-03' && r.model === low)).toMatchObject({ failures: [], reviewRequiredMatched: true })
  })
  it('retains the complete-answer reasoning/grade failures and unnecessary reviews', () => {
    expect(firstReview().reviews.find(r => r.id === 'B1-02' && r.model === low)?.failures).toContain('VALID_REASONING_NOT_CREDITED')
    expect(firstReview().reviews.find(r => r.id === 'B1-02' && r.model === medium)?.failures).toContain('CLASSIFICATION_OUTSIDE_ACCEPTABLE')
    for (const report of [firstReview(), repeatReview()]) {
      for (const row of report.reviews.filter(r => r.id === 'B1-04')) expect(row.failures).toContain('EVALUATION_REVIEW_REQUIRED')
    }
  })
  it('pins original fixtures/revision instead of rescoring failures under new labels', () => {
    for (const [name, report] of [['thinking-medium-focused-1', initial], ['thinking-medium-repeat-1', repeated]] as const) {
      const bytes = readFileSync(new URL(`./fixtures/interview-calibration-${name}.json`, import.meta.url))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(report.provenance.fixtureSha256)
      expect(report.provenance.applicationRevision).toBe('4eaca2b918c8c4dcbfe3c0538345df836955431d')
    }
  })
})
