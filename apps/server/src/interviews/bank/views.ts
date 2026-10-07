import type { BankDraft } from './schemas'
/** Learner projection excludes internal answer guidance, source material and review notes. */
export function learnerPreview(draft: BankDraft) {
  return {
    questionText: draft.questionText, track: draft.track, category: draft.category, topic: draft.topic,
    difficulty: draft.difficulty, experienceBand: draft.experienceBand, tags: draft.tags,
    explanation: draft.explanation, exampleAnswer: draft.exampleAnswer, expectedDepth: draft.expectedDepth,
  }
}
