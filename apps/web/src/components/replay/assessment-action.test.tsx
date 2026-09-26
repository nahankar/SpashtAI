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
  it('shows explicit confirmation-required state before personal analysis', () => {
    const html = renderToStaticMarkup(<ReplayAssessmentAction evidence={{
      ...evidence,
      identity: { state: 'confirmation_required', speaker: null, revision: null },
    }} hasAssessment={false} busy={false} onAnalyze={vi.fn()} />)
    expect(html).toContain('Confirm your speaker to generate personalized AI Insights.')
  })
  it('does not offer an assessment when current personalized results already exist', () => {
    expect(ReplayAssessmentAction({ evidence, hasAssessment: true, busy: false, onAnalyze: vi.fn() })).toBeNull()
  })
  it('withholds scoring when the confirmed speaker does not have enough speech', () => {
    const html = renderToStaticMarkup(<ReplayAssessmentAction evidence={{
      ...evidence,
      assessmentGate: 'insufficient_speech',
      speakers: [{ speaker: 'spk_1', excerpt: 'A short line.', preview: null, assessmentEligible: false }],
    }} hasAssessment={false} busy={false} onAnalyze={vi.fn()} />)
    expect(html).toContain('not enough of this speaker')
    expect(html).not.toContain('Analyze my speech')
  })
  it('disables the action while an assessment is running', () => {
    expect(renderToStaticMarkup(<ReplayAssessmentAction evidence={evidence}
      hasAssessment={false} busy onAnalyze={vi.fn()} />)).toContain('disabled=""')
  })
})
