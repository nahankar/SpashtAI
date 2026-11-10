import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import future from './fixtures/interview-calibration-grading-boundaries-1.json'
import prior from './fixtures/interview-calibration-ambiguity-baseline-1.json'
import scope from './fixtures/interview-calibration-question-scope-focused-1.json'
import saved from './fixtures/interview-grading-saved-ambiguity-baseline-1.json'
import { reviewCalibration, reviewCalibrationCase, type CalibrationCase } from '../scripts/review-interview-calibration'
import { deterministicResult, LEARNER_POLICIES } from '../src/interviews/evaluator/contracts'
const testCase = (id: string) => future.cases.find(c => c.id === id)! as CalibrationCase
const completed = (id: string, classification: string) => ({ id, model: 'OFFLINE_CONTRACT_ONLY', status: 'COMPLETED', result: { classification } })
const ungraded = (id: string) => ({ id, model: 'OFFLINE_CONTRACT_ONLY', status: 'FAILED', errorCode: 'EVALUATION_REVIEW_REQUIRED', result: null })
describe('future-only grading-boundary acceptance, not a model-quality result', () => {
  it('versions decisions without changing historical expectations or answers', () => {
    expect(prior.cases.find(c => c.id === 'C1-04')!.expected).toBe('UNASSESSED')
    expect(scope.cases.find(c => c.id === 'P2-07')!.expected).toBe('PARTIAL')
    expect(testCase('B1-01').expected).toBe('PARTIAL')
    expect(testCase('B1-02').expected).toBe('CORRECT')
    for (const c of future.cases.filter(c => c.adjudication)) {
      const provenance = c.adjudication!
      const file = `interview-calibration-${provenance.sourceFixtureVersion}.json`
      const bytes = readFileSync(new URL(`./fixtures/${file}`, import.meta.url))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sourceFixtureSha256)
      const source = JSON.parse(bytes.toString()).cases.find((x: { id: string }) => x.id === provenance.sourceCaseId)
      expect(c.answer).toBe(source.answer)
      expect(provenance.previousExpected).toBe(source.expected)
    }
  })
  it('rejects full credit and unnecessary review for clear incomplete knowledge', () => {
    for (const id of ['B1-01', 'B1-05', 'B1-10']) {
      expect(reviewCalibrationCase(testCase(id), completed(id, 'PARTIAL')).failures).toEqual([])
      expect(reviewCalibrationCase(testCase(id), completed(id, 'CORRECT')).failures).toContain('CLASSIFICATION_OUTSIDE_ACCEPTABLE')
      expect(reviewCalibrationCase(testCase(id), ungraded(id)).failures).toContain('EVALUATION_REVIEW_REQUIRED')
    }
  })
  it('requires the complete focus-order answer to retain reasoning without an optional-example gap', () => {
    const id = 'B1-02'
    const row = { ...completed(id, 'CORRECT'), result: { classification: 'CORRECT',
      criteria: [{ criterion: 'REASONING', finding: 'MET', evidence: ['Uh, competing manual order?'] }], gaps: [] as string[] } }
    expect(reviewCalibrationCase(testCase(id), row).failures).toEqual([])
    expect(reviewCalibrationCase(testCase(id), { ...row, result: { ...row.result, gaps: ['Missing example'] } }).failures).toContain('FORBIDDEN_GAP')
  })
  it('does not allow any knowledge grade for unresolvable meaning', () => {
    for (const id of ['B1-03', 'B1-06']) {
      expect(reviewCalibrationCase(testCase(id), ungraded(id)).failures).toEqual([])
      for (const grade of ['CORRECT', 'PARTIAL', 'INCORRECT', 'NOT_ANSWERED']) {
        expect(reviewCalibrationCase(testCase(id), completed(id, grade)).failures).toEqual(['EXPECTED_UNGRADED_REVIEW'])
      }
    }
  })
  it('keeps instruction echo distinct from review and clear false beliefs', () => {
    for (const id of ['B1-04', 'B1-07']) {
      expect(reviewCalibrationCase(testCase(id), completed(id, 'NOT_ANSWERED')).failures).toEqual([])
      expect(reviewCalibrationCase(testCase(id), ungraded(id)).failures).toContain('EVALUATION_REVIEW_REQUIRED')
    }
    expect(reviewCalibrationCase(testCase('B1-08'), completed('B1-08', 'PARTIAL')).failures).toContain('CLASSIFICATION_OUTSIDE_ACCEPTABLE')
  })
  it('refuses to use the new labels to rescore the saved old trial', () => {
    expect(() => reviewCalibration({ ...future, cases: future.cases as CalibrationCase[] }, saved)).toThrow('Fixture version mismatch')
  })
  it('does not deterministically discard a partial answer because it admits missing knowledge', () => {
    for (const id of ['B1-05', 'B1-10']) {
      expect(deterministicResult(LEARNER_POLICIES['learner-evaluation-16'], testCase(id).answer)).toBeNull()
    }
  })
})
