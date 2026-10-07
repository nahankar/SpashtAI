import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Preparation } from '@/lib/prepare-types'
import { QuestionMemory } from './QuestionMemory'

const journey = {
  id: 'journey',
  stages: [{ id: 'stage', name: 'Technical' }],
  nextStage: { id: 'stage', name: 'Technical' },
  questions: [{ id: 'q1', stageId: 'stage', questionText: 'Explain XPath axes', source: 'ACTUAL_INTERVIEW' }],
} as unknown as Preparation

describe('QuestionMemory ownership', () => {
  it('lets the owner add and delete questions', () => {
    const html = renderToStaticMarkup(<QuestionMemory journey={journey} onChanged={async () => {}} />)
    expect(html).toContain('Explain XPath axes')
    expect(html).toContain('aria-label="Delete question"')
    expect(html).toContain('Add question')
  })

  it('is read-only for an admin viewing another user journey', () => {
    const html = renderToStaticMarkup(<QuestionMemory journey={journey} onChanged={async () => {}} readOnly />)
    expect(html).toContain('Explain XPath axes')
    expect(html).not.toContain('aria-label="Delete question"')
    expect(html).not.toContain('Add question')
  })
})
