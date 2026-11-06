import { describe, expect, it } from 'vitest'
import { CURRENT_LEARNER_POLICY, LEARNER_POLICIES, invalidOutputReason, parseResult } from '../src/interviews/evaluator/contracts'

const answer = 'It composes dependent work. It makes every call synchronous.'
const correct = { quote: 'It composes dependent work.', judgment: 'CORRECT', scope: 'CENTRAL', reasoning: 'VALID', explanation: 'Composition chains dependent asynchronous work.' }
const falseClaim = { quote: 'It makes every call synchronous.', judgment: 'INCORRECT', scope: 'SECONDARY', reasoning: 'INVALID', explanation: 'Composition does not make every call synchronous.' }
const ledger = (claims: unknown[], coverage = 'INCOMPLETE') => ({ claims, coverage,
  depth: { finding: 'NOT_ASSESSED', evidence: [], explanation: 'No additional depth demonstrated.' }, gaps: [], guidance: 'Review dependent composition.', uncertainty: [] })
const parse = (raw: unknown, text = answer) => parseResult(JSON.stringify(raw), text, 'interview-result-5')

describe('preview claim-based grading', () => {
  it('preserves the current policy and introduces an independent pinned candidate', () => {
    expect(CURRENT_LEARNER_POLICY).toBe('learner-evaluation-8')
    expect(LEARNER_POLICIES['learner-evaluation-9'].config).toMatchObject({ prompt: 'interview-answer-11', schema: 'interview-result-5', rubric: 'bank-guidance-4' })
    expect(LEARNER_POLICIES['learner-evaluation-10'].config).toMatchObject({ prompt: 'interview-answer-12', schema: 'interview-result-5', rubric: 'bank-guidance-4' })
  })
  it('retains correct concepts beside a false secondary claim and derives PARTIAL', () => {
    const result = parse(ledger([correct, falseClaim], 'COMPLETE'))
    expect(result.classification).toBe('PARTIAL')
    expect(result.strengths).toEqual([correct.explanation])
    expect(result.misconceptions).toEqual([falseClaim.explanation])
    expect(result.criteria.find(c => c.criterion === 'REASONING')?.finding).toBe('PARTIAL')
  })
  it('derives INCORRECT from a false central claim without erasing the correct concept', () => {
    const result = parse(ledger([{ ...correct, scope: 'SECONDARY' }, { ...falseClaim, scope: 'CENTRAL' }]))
    expect(result.classification).toBe('INCORRECT')
    expect(result.strengths).toEqual([correct.explanation])
    expect(result.criteria[0]).toMatchObject({ finding: 'NOT_MET', evidence: [falseClaim.quote] })
  })
  it('keeps a mixed answer PARTIAL when an essential concept is correct alongside another false one', () => {
    expect(parse(ledger([correct, { ...falseClaim, scope: 'CENTRAL' }])).classification).toBe('PARTIAL')
    expect(parse(ledger([correct], 'INCOMPLETE')).classification).toBe('PARTIAL')
  })
  it('credits implicit valid reasoning without requiring a causal keyword', () => {
    const result = parse(ledger([correct], 'COMPLETE'))
    expect(result.classification).toBe('CORRECT')
    expect(result.criteria[1]).toMatchObject({ finding: 'MET', evidence: [correct.quote] })
  })
  it('does not turn a vague but substantive false claim into no answer', () => {
    const result = parse(ledger([falseClaim], 'NONE'))
    expect(result.classification).toBe('INCORRECT')
    expect(result.criteria[1].finding).toBe('NOT_MET')
  })
  it('derives an unassessed no-answer result from empty content', () => {
    const result = parse(ledger([{ ...correct, judgment: 'EMPTY', reasoning: 'NONE', quote: 'It is better.' }], 'NONE'), 'It is better.')
    expect(result).toMatchObject({ classification: 'NOT_ANSWERED', strengths: [], misconceptions: [], gaps: [] })
    expect(result.criteria.every(c => c.finding === 'NOT_ASSESSED')).toBe(true)
  })
  it.each(['VALID', 'PARTIAL'])('rejects %s reasoning credit on a false claim', reasoning => {
    expect(() => parse(ledger([{ ...falseClaim, reasoning }], 'NONE'))).toThrow('INCONSISTENT')
  })
  it('rejects invented, changed and duplicate quotations instead of inventing support', () => {
    expect(() => parse(ledger([{ ...correct, quote: 'Invented.' }]))).toThrow('UNSUPPORTED_EVIDENCE')
    expect(() => parse(ledger([correct, correct]))).toThrow('INVALID_CRITERIA')
    const result = parse(ledger([correct], 'COMPLETE'), 'It composes\ndependent work.')
    expect(result.criteria[0].evidence).toEqual(['It composes\ndependent work.'])
  })
  it('rejects contradictory coverage, depth and free-form verdict overrides', () => {
    expect(() => parse(ledger([correct], 'NONE'))).toThrow('INCONSISTENT')
    expect(() => parse(ledger([], 'COMPLETE'))).toThrow('INCONSISTENT')
    expect(() => parse({ ...ledger([correct], 'COMPLETE'), gaps: ['A required point is missing.'] })).toThrow('INCONSISTENT')
    expect(() => parse({ ...ledger([correct]), classification: 'CORRECT' })).toThrow()
    expect(() => parse({ ...ledger([], 'NONE'), depth: { finding: 'MET', evidence: ['It is better.'], explanation: 'Depth.' } }, 'It is better.')).toThrow('INCONSISTENT')
  })
  it.each([
    [ledger([correct], 'NONE'), 'CORRECT_WITH_NO_COVERAGE'],
    [ledger([], 'COMPLETE'), 'EMPTY_WITH_COVERAGE'],
    [ledger([{ ...correct, scope: 'SECONDARY' }], 'COMPLETE'), 'COMPLETE_WITHOUT_CORE'],
    [{ ...ledger([correct], 'COMPLETE'), gaps: ['Missing essential.'] }, 'CORRECT_WITH_GAPS'],
    [ledger([{ ...falseClaim, reasoning: 'VALID' }], 'NONE'), 'TRUTH_REASONING_CONFLICT'],
    [ledger([correct, correct]), 'DUPLICATE_PASSAGE'],
  ])('identifies a rejected shape without leaking answer/provider text', (raw, reason) => {
    try { parse(raw); throw new Error('Expected rejection') } catch (error) {
      expect(invalidOutputReason(error)).toBe(`INVALID_OUTPUT_CLAIM_${reason}`)
      expect(invalidOutputReason(error)).not.toContain(answer)
    }
  })
})
