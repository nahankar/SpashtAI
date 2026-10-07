import type { BankDraft } from './schemas'
/** Explicit projection: neither raw source answers nor evaluator material can leak into preview. */
export function learnerPreview(draft: BankDraft) {
  return {
    questionText: draft.questionText, track: draft.track, category: draft.category, topic: draft.topic,
    difficulty: draft.difficulty, experienceBand: draft.experienceBand, tags: draft.tags,
    explanation: draft.explanation, exampleAnswer: draft.exampleAnswer,
    criteria: draft.publicCriteria.map(({ id, label }) => ({ id, label })), expectedDepth: draft.expectedDepth,
  }
}
