import { draftSchema } from '../../src/interviews/bank/schemas'
export function readyDraft() {
  return draftSchema.parse({ questionText: 'How do you isolate an automated test?', track: 'Automation Testing', category: 'Testing', topic: 'Isolation',
    difficulty: 'Medium', experienceBand: '2-5', evaluationMode: 'TECHNICAL', verbalSuitable: true,
    expectedDepth: 'Explain isolation and give one example.', explanation: 'Independent setup prevents test coupling.', exampleAnswer: 'I reset state and avoid shared mutable fixtures.',
    referenceSources: ['Team-authored testing guide, reviewed 7 Oct 2026'], rightsBasis: 'OWNED', rightsNotes: 'Created and owned by our team.',
    publicCriteria: [{ id: 'isolation', label: 'Test isolation' }],
    rubric: { criteria: [{ id: 'isolation', essential: true, points: ['Independent state'], alternatives: ['Fresh fixtures'], misconceptions: ['Tests depend on order'], anchors: ['No isolation', 'Mentions isolation', 'Explains independent state', 'Explains state with trade-offs'] }] },
  })
}
