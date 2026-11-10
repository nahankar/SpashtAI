import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import initial from './fixtures/interview-calibration-ambiguity-baseline-1.json'
import repeat from './fixtures/interview-calibration-ambiguity-repeat-1.json'
import initialResults from './fixtures/interview-grading-saved-ambiguity-baseline-1.json'
import repeatResults from './fixtures/interview-grading-saved-ambiguity-repeat-1.json'
import { reviewCalibration, type CalibrationCase } from '../scripts/review-interview-calibration'
const review = (f: typeof initial | typeof repeat, r: typeof initialResults | typeof repeatResults) =>
  reviewCalibration({ ...f, cases: f.cases as CalibrationCase[] }, r)
describe('saved real-model ambiguity diagnostic, not a fresh quality test', () => {
  it('keeps frozen initial and repeated disagreements visible', () => {
    expect(review(initial, initialResults)).toMatchObject({ decision: 'HOLD_GRADE_DRIVEN_ADAPTATION',
      summary: { cases: 9, failedCases: 2, matchedUngradedReviews: 1 } })
    expect(review(repeat, repeatResults)).toMatchObject({ decision: 'HOLD_GRADE_DRIVEN_ADAPTATION',
      summary: { cases: 3, failedCases: 1, matchedUngradedReviews: 1 } })
    expect([...initialResults.results, ...repeatResults.results].every(r => !r.reused)).toBe(true)
  })
  it('preserves the disputed PARTIAL grade and its acknowledged missing mapping', () => {
    const row = initialResults.results.find(r => r.id === 'C1-04')!
    expect(row.result).toMatchObject({ classification: 'PARTIAL' })
    expect(row.result!.gaps.some(g => g.includes('Fails to identify which table type'))).toBe(true)
    expect(review(initial, initialResults).reviews.find(r => r.id === 'C1-04')?.failures).toEqual(['EXPECTED_UNGRADED_REVIEW'])
  })
  it('retains stable old ambiguous/correct/no-answer outcomes without reclassifying the old unsafe trial', () => {
    for (const id of ['N15-03', 'N15-01', 'P2-02']) {
      const a = initialResults.results.find(r => r.id === id)!, b = repeatResults.results.find(r => r.id === id)!
      expect([a.status, a.errorCode, a.result?.classification]).toEqual([b.status, b.errorCode, b.result?.classification])
    }
    expect(initialResults.results.find(r => r.id === 'N15-03')).toMatchObject({ errorCode: 'EVALUATION_REVIEW_REQUIRED', result: null })
    expect(review(initial, initialResults).reviews.find(r => r.id === 'P2-02')?.failures).toContain('EVALUATION_REVIEW_REQUIRED')
  })
  it('pins both frozen expectation files for offline replay', () => {
    for (const [name, report] of [['ambiguity-baseline-1', initialResults], ['ambiguity-repeat-1', repeatResults]] as const) {
      const bytes = readFileSync(new URL(`./fixtures/interview-calibration-${name}.json`, import.meta.url))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(report.provenance.fixtureSha256)
      expect(report.provenance.applicationRevision).toBe('ffa70ed326db3cfd737227fce08c65fc4cbbb379')
    }
  })
})
