import { describe, expect, it } from 'vitest'
import { activationBlockers, bulkSchema, draftSchema } from '../src/interviews/bank/schemas'
import { learnerPreview } from '../src/interviews/bank/views'
import { followUpSchema, followUpIdentity } from '../src/interviews/bank/followUps'
import { readyDraft } from './fixtures/bank-draft'
import wirePreview from '../../../test/contracts/bank-learner-preview.json'
describe('simple bank content boundaries', () => {
  it('uses sensible metadata defaults without inventing learning content', () => {
    expect(draftSchema.parse({ questionText: 'A question?' })).toMatchObject({ track: 'General', difficulty: 'Medium', experienceBand: '2-5', frequency: 'Core', verbalSuitable: true, exampleAnswer: '', goodAnswerPoints: '' })
  })
  it('requires a confirmed track, spoken suitability and answer guidance only for activation', () => {
    expect(activationBlockers(readyDraft())).toEqual([])
    expect(activationBlockers(draftSchema.parse({ questionText: 'A question?' }))).toHaveLength(2)
    expect(activationBlockers({ ...readyDraft(), verbalSuitable: false })).toContain('Question is not suitable for spoken practice')
    expect(activationBlockers({ ...readyDraft(), goodAnswerPoints: '' })).toEqual([])
  })
  it('keeps internal guidance and notes out of learner preview', () => {
    const result = learnerPreview(readyDraft())
    expect(result).toEqual(wirePreview)
    expect(JSON.stringify(result)).not.toMatch(/goodAnswerPoints|followUpGuidance|generationNotes|reviewNotes|Private editorial/)
  })
  it('rejects stale versioning fields and duplicate bulk selections', () => {
    expect(draftSchema.safeParse({ ...readyDraft(), rubric: {} }).success).toBe(false)
    expect(bulkSchema.safeParse({ action: 'delete', questions: [{ id: 'a', revision: 1 }, { id: 'a', revision: 1 }] }).success).toBe(false)
    expect(bulkSchema.safeParse({ action: 'delete', questions: [] }).success).toBe(false)
  })
  it('deduplicates generated questions across sessions and whitespace differences', () => {
    expect(followUpIdentity({ questionText: ' How do tests work? ', track: 'Python' })).toEqual(followUpIdentity({ questionText: 'how  do tests work?', track: 'PYTHON' }))
  })
  it('accepts only enriched follow-ups and rejects candidate response payloads', () => {
    expect(followUpSchema.safeParse({ turnId: 'turn-a', draft: readyDraft() }).success).toBe(true)
    expect(followUpSchema.safeParse({ turnId: 'turn-a', draft: { ...readyDraft(), exampleAnswer: '' } }).success).toBe(false)
    expect(followUpSchema.safeParse({ turnId: 'turn-a', draft: readyDraft(), candidateAnswer: 'Private response' }).success).toBe(false)
  })
})
