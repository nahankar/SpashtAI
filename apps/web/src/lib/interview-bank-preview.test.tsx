import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionBankPreview } from '../components/admin/QuestionBankPreview'
import wirePreview from '../../../../test/contracts/bank-learner-preview.json'
describe('bank learner preview wire contract', () => {
  it('renders the server contract question, criterion, explanation and example', () => {
    const html = renderToStaticMarkup(<QuestionBankPreview data={{ status: 'DRAFT', preview: wirePreview }} />)
    expect(html).toContain(wirePreview.questionText); expect(html).toContain(wirePreview.criteria[0].label)
    expect(html).toContain(wirePreview.exampleAnswer); expect(html).toContain(wirePreview.explanation)
    expect(html).toContain('Admin preview only'); expect(html).not.toContain('rubric')
  })
})
