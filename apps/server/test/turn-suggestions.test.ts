import { describe, expect, it } from 'vitest'
import { parseSuggestions, type Candidate } from '../src/analytics/turnSuggestions'

const candidates: Candidate[] = [
  { turnId: 'turn-a', turnIndex: 5, text: 'Let me put a mock message together.', wordCount: 20, fillers: 0 },
  { turnId: 'turn-b', turnIndex: 7, text: 'Hello everyone, this is the intro.', wordCount: 22, fillers: 0 },
]

describe('turn suggestion parsing', () => {
  it('binds each suggestion to the exact candidate turn id', () => {
    const raw = JSON.stringify([
      { turnIndex: 5, kind: 'concise', suggestion: 'Tighten it.', rewrite: 'Mock message.' },
      { turnIndex: 7, kind: 'clarity', suggestion: 'Lead with the purpose.' },
    ])

    expect(parseSuggestions(raw, candidates)).toEqual([
      { turnIndex: 5, turnId: 'turn-a', kind: 'concise', suggestion: 'Tighten it.', rewrite: 'Mock message.' },
      { turnIndex: 7, turnId: 'turn-b', kind: 'clarity', suggestion: 'Lead with the purpose.', rewrite: undefined },
    ])
  })

  it('drops suggestions for turns that were not sent to the model', () => {
    const raw = JSON.stringify([
      { turnIndex: 3, kind: 'wording', suggestion: 'Not a candidate.' },
      { turnIndex: 7, kind: 'wording', suggestion: 'Candidate.' },
    ])

    expect(parseSuggestions(raw, candidates).map((s) => s.turnId)).toEqual(['turn-b'])
  })
})
