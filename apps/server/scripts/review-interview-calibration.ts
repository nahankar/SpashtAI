// Offline acceptance review; no provider calls or application mutations.
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export type CalibrationCase = {
  id?: string; name?: string; answer: string; expected: string; acceptable?: string[]; mustNotBe?: string[]
  expectedDisposition?: 'GRADED' | 'REVIEW_REQUIRED'
  evidence?: string[]; mustNotQuote?: string[]; mustNotGap?: string[]; expectMisconception?: boolean
  expectGap?: string; mustNotSay?: string[]; expectReasoning?: boolean; reasoningMustNotBeMet?: boolean
  expectStrength?: string[]; expectedKind?: string; expectAcknowledged?: string[]
}
type Grade = {
  classification?: string; responseKind?: string; assessmentIssues?: string[]
  criteria?: { criterion: string; finding: string; evidence: string[]; explanation?: string }[]
  strengths?: string[]; gaps?: string[]; misconceptions?: string[]; guidance?: string
}
export type CalibrationRow = { id?: string | null; name?: string; model: string; status: string; errorCode?: string | null; result?: Grade | null }
const lower = (items: string[] = []) => items.join(' ').toLowerCase()

export function reviewCalibrationCase(test: CalibrationCase, row: CalibrationRow) {
  const grade = row.result
  if (test.expectedDisposition === 'REVIEW_REQUIRED') {
    const matched = row.status === 'FAILED' && row.errorCode === 'EVALUATION_REVIEW_REQUIRED' && !grade
    return { id: test.id ?? test.name, model: row.model, actual: grade?.classification ?? null,
      usable: Boolean(grade?.classification), reviewRequiredMatched: matched,
      failures: matched ? [] : ['EXPECTED_UNGRADED_REVIEW'] }
  }
  if (row.status !== 'COMPLETED' || !grade?.classification) {
    return { id: test.id ?? test.name, model: row.model, actual: null, usable: false, failures: [row.errorCode ?? 'NO_COMPLETED_GRADE'] }
  }
  const failures: string[] = []
  const check = (ok: boolean, code: string) => { if (!ok) failures.push(code) }
  if (grade.assessmentIssues?.length) check(false, 'ASSESSMENT_REQUIRES_HOLD')
  const quotes = (grade.criteria ?? []).flatMap(c => c.evidence)
  const feedback = lower([...(grade.criteria ?? []).map(c => c.explanation ?? ''), ...(grade.gaps ?? []), ...(grade.strengths ?? []), grade.guidance ?? ''])
  check((test.acceptable ?? [test.expected]).includes(grade.classification), 'CLASSIFICATION_OUTSIDE_ACCEPTABLE')
  check(!(test.mustNotBe ?? []).includes(grade.classification), 'FORBIDDEN_CLASSIFICATION')
  check(quotes.every(q => test.answer.includes(q)), 'UNSUPPORTED_QUOTATION')
  if (test.evidence?.length) check(test.evidence.some(a => quotes.some(q => q.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(q.toLowerCase()))), 'MISSING_EVIDENCE_ANCHOR')
  if (test.mustNotQuote) check(!test.mustNotQuote.some(a => quotes.some(q => q.toLowerCase().includes(a.toLowerCase())) || lower(grade.strengths).includes(a.toLowerCase())), 'FORBIDDEN_CREDIT_OR_QUOTE')
  if (test.expectMisconception !== undefined) check(Boolean(grade.misconceptions?.length) === test.expectMisconception, 'MISCONCEPTION_EXPECTATION')
  if (test.expectGap) check(lower(grade.gaps).includes(test.expectGap.toLowerCase()), 'MISSING_EXPECTED_GAP')
  if (test.mustNotGap) check(!test.mustNotGap.some(t => lower([...(grade.gaps ?? []), ...(grade.misconceptions ?? [])]).includes(t.toLowerCase())), 'FORBIDDEN_GAP')
  if (test.mustNotSay) check(!test.mustNotSay.some(t => feedback.includes(t.toLowerCase())), 'FORBIDDEN_FEEDBACK_WORDING')
  const reasoning = grade.criteria?.find(c => c.criterion === 'REASONING')
  // A negative finding does not mean a valid explanation was credited.
  if (test.expectReasoning) check(Boolean(reasoning && ['MET', 'PARTIAL'].includes(reasoning.finding)), 'VALID_REASONING_NOT_CREDITED')
  if (test.reasoningMustNotBeMet) check(reasoning?.finding !== 'MET', 'FALSE_OR_EMPTY_REASON_MET')
  if (test.expectStrength) check(test.expectStrength.every(t => lower(grade.strengths).includes(t.toLowerCase())), 'MISSING_CORRECT_STRENGTH')
  if (test.expectedKind) check(grade.responseKind === test.expectedKind, 'RESPONSE_KIND_MISMATCH')
  if (test.expectAcknowledged) check(test.expectAcknowledged.every(t => lower([...(grade.strengths ?? []), ...(grade.criteria ?? []).map(c => c.explanation ?? '')]).includes(t.toLowerCase())), 'MISSING_ACKNOWLEDGMENT')
  return { id: test.id ?? test.name, model: row.model, actual: grade.classification, usable: true,
    acceptableClassification: (test.acceptable ?? [test.expected]).includes(grade.classification),
    exactExpected: grade.classification === test.expected, failures }
}

export function reviewCalibration(fixture: { fixtureVersion: string; cases: CalibrationCase[] }, run: { fixtureVersion: string; results: CalibrationRow[] }) {
  if (run.fixtureVersion !== fixture.fixtureVersion) throw new Error('Fixture version mismatch')
  const ids = fixture.cases.map(c => c.id ?? c.name)
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('Fixture requires unique case IDs')
  const models = [...new Set(run.results.map(r => r.model))]
  if (!models.length) throw new Error('No evaluated models')
  if (run.results.some(r => !ids.includes(r.id ?? r.name))) throw new Error('Unexpected result case')
  const reviews = models.flatMap(model => fixture.cases.map(test => {
    const rows = run.results.filter(r => r.model === model && (r.id ?? r.name) === (test.id ?? test.name))
    if (rows.length > 1) throw new Error('Duplicate result case/model')
    return reviewCalibrationCase(test, rows[0] ?? { id: test.id, model, status: 'MISSING' })
  }))
  const allRequiredChecksPass = reviews.every(r => (r.usable || ('reviewRequiredMatched' in r && r.reviewRequiredMatched)) && r.failures.length === 0)
  const allRoutingLabelsMatch = reviews.every(r => ('reviewRequiredMatched' in r && r.reviewRequiredMatched) || (r.usable && !r.failures.includes('ASSESSMENT_REQUIRES_HOLD') && 'exactExpected' in r && r.exactExpected))
  return { fixtureVersion: fixture.fixtureVersion, calibrated: false,
    decision: allRequiredChecksPass && allRoutingLabelsMatch ? 'SAMPLE_PASSED_REVIEW_STILL_REQUIRED' : 'HOLD_GRADE_DRIVEN_ADAPTATION',
    limitation: 'Bank-relative AI-reviewed regression labels, not independent expert calibration or repeated-run reliability. A broader acceptable band can contain different adaptive actions; resolve routing-label disagreements before enablement.',
    summary: { coreGradesRequiringHold: run.results.filter(r => r.result?.assessmentIssues?.length).length, cases: reviews.length, usable: reviews.filter(r => r.usable).length,
      expectedUngradedReviews: fixture.cases.filter(c => c.expectedDisposition === 'REVIEW_REQUIRED').length * models.length,
      matchedUngradedReviews: reviews.filter(r => 'reviewRequiredMatched' in r && r.reviewRequiredMatched).length,
      acceptableClassification: reviews.filter(r => 'acceptableClassification' in r && r.acceptableClassification).length,
      exactExpected: reviews.filter(r => 'exactExpected' in r && r.exactExpected).length,
      allRequiredChecksPass, allRoutingLabelsMatch, failedCases: reviews.filter(r => r.failures.length > 0).length }, reviews }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [fixturePath, resultPath, outputPath] = process.argv.slice(2)
  if (!fixturePath || !resultPath || !outputPath) throw new Error('Usage: review-interview-calibration.ts fixture.json results.json review.json')
  const review = reviewCalibration(JSON.parse(await readFile(fixturePath, 'utf8')), JSON.parse(await readFile(resultPath, 'utf8')))
  await writeFile(outputPath, JSON.stringify(review, null, 2) + '\n')
  console.log(JSON.stringify({ decision: review.decision, ...review.summary }))
  if (review.decision === 'HOLD_GRADE_DRIVEN_ADAPTATION') process.exitCode = 1
}
