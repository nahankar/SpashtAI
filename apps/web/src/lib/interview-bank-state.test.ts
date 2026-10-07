import { describe, expect, it } from 'vitest'
import { bankStatus, emptyDraft } from './interview-bank'
describe('simple question-bank state', () => {
  it('distinguishes approved inactive content from active practice questions', () => {
    expect(bankStatus({ approved:false,active:false })).toBe('Draft · inactive')
    expect(bankStatus({ approved:true,active:false })).toBe('Approved · inactive')
    expect(bankStatus({ approved:true,active:true })).toBe('Active')
  })
  it('starts with useful metadata and empty learner guidance', () => {
    expect(emptyDraft()).toMatchObject({ track:'General',difficulty:'Medium',experienceBand:'2-5',goodAnswerPoints:'',exampleAnswer:'',explanation:'' })
    expect(emptyDraft()).not.toHaveProperty('rubric')
  })
})
