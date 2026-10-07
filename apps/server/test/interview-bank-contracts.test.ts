import { describe, expect, it } from 'vitest'
import { draftSchema, publicationBlockers } from '../src/interviews/bank/schemas'
import { learnerPreview } from '../src/interviews/bank/views'
import { readyDraft } from './fixtures/bank-draft'
import wirePreview from '../../../test/contracts/bank-learner-preview.json'
describe('bank publication and learner boundaries', () => {
  it('allows a complete rights-backed manually authored rubric', () => expect(publicationBlockers(readyDraft())).toEqual([]))
  it('imports incomplete material without making it publishable', () => {
    const draft = draftSchema.parse({ questionText: 'A source question?' })
    expect(publicationBlockers(draft)).toContain('Record content rights or independent rewriting provenance')
  })
  it('lets an editor save incomplete criterion drafts but blocks review/publication', () => {
    const draft = readyDraft(); draft.publicCriteria[0].label = ''; draft.rubric!.criteria[0].anchors[0] = ''
    expect(draftSchema.safeParse(draft).success).toBe(true)
    expect(publicationBlockers(draft)).toContain('Complete learner criterion labels and all four private scoring anchors')
  })
  it('requires rewritten learner content and independent rubric authorship', () => {
    const draft = { ...readyDraft(), rightsBasis: 'REWRITTEN' as const }
    expect(publicationBlockers(draft)).toContain('Confirm independent learner rewriting and rubric authorship')
    expect(publicationBlockers({ ...draft, learnerContentRewritten: true, rubricIndependentlyAuthored: true }, { sourceQuestionText: draft.questionText })).toContain('Rewrite the source question before publishing as rewritten content')
  })
  it('rejects copied reference answers even with rewriting attestation', () => {
    const draft = { ...readyDraft(), rightsBasis: 'REWRITTEN' as const, learnerContentRewritten: true, rubricIndependentlyAuthored: true }
    expect(publicationBlockers(draft, { sourceAnswer: draft.exampleAnswer })).toContain('Learner content still copies the source answer')
  })
  it('requires public and private criteria to match exactly once', () => {
    expect(publicationBlockers({ ...readyDraft(), publicCriteria: [{ id: 'other', label: 'Other' }] })).toContain('Each public criterion must have exactly one matching private rubric criterion')
  })
  it('only projects permitted learner fields', () => {
    const draft = readyDraft(); const result = JSON.stringify(learnerPreview(draft))
    expect(result).not.toContain('Tests depend on order'); expect(result).not.toContain('rubric'); expect(result).not.toContain('rightsNotes')
    expect(learnerPreview(draft).criteria).toEqual([{ id: 'isolation', label: 'Test isolation' }])
    expect(learnerPreview(draft)).toEqual(wirePreview)
  })
  it('rejects unexpected fields and malformed anchor scales', () => {
    expect(draftSchema.safeParse({ ...readyDraft(), sourceAnswer: 'Private source' }).success).toBe(false)
    const draft = readyDraft(); draft.rubric!.criteria[0].anchors.pop()
    expect(draftSchema.safeParse(draft).success).toBe(false)
  })
})
