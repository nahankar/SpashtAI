import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ReplayAssessmentAction } from './ReplayAssessmentAction'

describe('Replay personal assessment entry point', () => {
  const evidence = { identity: { state: 'confirmed', speaker: 'spk_1', revision: 'r' } }
  it('offers the initial assessment independently of the privileged Reprocess capability', () => {
    const onAnalyze = vi.fn()
    const html = renderToStaticMarkup(<ReplayAssessmentAction
      evidence={evidence} hasAssessment={false} busy={false} onAnalyze={onAnalyze}
    />)
    expect(html).toContain('Analyze my speech')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('Valid saved transcription is reused')
    expect(onAnalyze).not.toHaveBeenCalled()
  })
  it('does not offer an assessment for an unconfirmed speaker or an already current result', () => {
    expect(ReplayAssessmentAction({ evidence: { ...evidence, identity: { state: 'confirmation_required', speaker: null, revision: null } },
      hasAssessment: false, busy: false, onAnalyze: vi.fn() })).toBeNull()
    expect(ReplayAssessmentAction({ evidence, hasAssessment: true, busy: false, onAnalyze: vi.fn() })).toBeNull()
  })
  it('disables the action while an assessment is running', () => {
    expect(renderToStaticMarkup(<ReplayAssessmentAction evidence={evidence}
      hasAssessment={false} busy onAnalyze={vi.fn()} />)).toContain('disabled=""')
  })
})
