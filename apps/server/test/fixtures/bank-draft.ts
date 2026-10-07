import { draftSchema } from '../../src/interviews/bank/schemas'
export function readyDraft() {
  return draftSchema.parse({ questionText: 'How do you isolate an automated test?', track: 'Automation Testing', category: 'Testing', topic: 'Isolation',
    expectedDepth: 'Explain isolation and give one example.', explanation: 'Independent setup prevents test coupling.', exampleAnswer: 'I reset state and avoid shared mutable fixtures.',
    goodAnswerPoints: 'Independent state\nFresh fixtures', followUpGuidance: 'Correct: discuss parallel execution. Partial: clarify shared state. Unknown: try a foundational testing question.',
    reviewNotes: 'Private editorial note', referenceSources: ['Team-authored testing guide'], generationNotes: 'Team-authored example.',
  })
}
