import type { EvaluationResult } from '../../src/interviews/evaluator/contracts'
export const testAnswer = 'Each test needs independent state and fresh fixtures.'
export function correctEvaluation(answer = testAnswer): EvaluationResult {
  return { classification: 'CORRECT', criteria: [
    { criterion: 'ACCURACY', finding: 'MET', evidence: [answer], explanation: 'Independent state avoids interference.' },
    { criterion: 'REASONING', finding: 'NOT_ASSESSED', evidence: [], explanation: 'No reasoning requested in this short question.' },
    { criterion: 'DEPTH', finding: 'NOT_ASSESSED', evidence: [], explanation: 'No further depth requested.' },
  ], strengths: ['Independent state identified'], gaps: [], misconceptions: [], guidance: 'Try applying this to shared databases.', uncertainty: [], followUpQuestion: 'How would you isolate a shared database fixture?' }
}
