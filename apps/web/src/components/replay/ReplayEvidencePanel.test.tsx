import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ReplayDeliveryNote, ReplayEvidencePanel } from './ReplayEvidencePanel'
import type { ReplayEvidence } from './evidence-contract'

vi.mock('@/lib/api-client', () => ({ getAuthHeaders: () => ({}) }))

const evidence = {
  version: 'replay-delivery-v1',
  transcriptRevision: 'rev',
  state: 'unavailable',
  reason: 'word_timing_missing_or_legacy',
  coverage: 1,
  eligibleWords: 40,
  excludedWords: 0,
  recording: null,
  identity: { state: 'confirmed', speaker: 'Neelesh Ahankari', revision: 'sel' },
  speakerChoice: 'named',
  speakers: [
    { speaker: 'Neelesh Ahankari', excerpt: 'What systems are they using today?', preview: null },
    { speaker: 'Vasant Mugada', excerpt: 'They want a singular framework.', preview: null },
  ],
  source: 'test',
  accuracy: 'not_human_validated',
  measurement: 'Cue times are not measured delivery.',
  limitations: [],
  supplementaryTranscript: null,
  pace: { wpm: null, status: 'insufficient_evidence' },
  moments: [],
} satisfies ReplayEvidence

describe('Replay speaker confirmation after analysis', () => {
  it('hides speaker choices after confirmation until edit is opened', () => {
    const collapsed = renderToStaticMarkup(<ReplayEvidencePanel
      sessionId="synthetic" evidence={evidence} audioDisabled sessionName="Vedanta - Digital as a Service"
      meetingDate="2026-08-06" onConfirmed={vi.fn()}
    />)
    expect(collapsed).not.toContain('They want a singular framework.')
    expect(collapsed).not.toContain('Confirm details and analyze')
    expect(collapsed).not.toContain('Delivery evidence')
    const note = renderToStaticMarkup(<ReplayDeliveryNote evidence={evidence} />)
    expect(note).toContain('aria-label="Delivery evidence"')
    expect(note).not.toContain('Pace: Not available')
    const opened = renderToStaticMarkup(<ReplayEvidencePanel
      sessionId="synthetic" evidence={evidence} audioDisabled editing onConfirmed={vi.fn()}
    />)
    expect(opened).toContain('They want a singular framework.')
    expect(opened).toContain('Confirm details and analyze')
  })

  it('shows every speaker while confirmation is still required', () => {
    const html = renderToStaticMarkup(<ReplayEvidencePanel
      sessionId="synthetic" evidence={{ ...evidence, identity: { state: 'confirmation_required', speaker: null, revision: null } }}
      audioDisabled onConfirmed={vi.fn()}
    />)
    expect(html).toContain('Vasant Mugada')
    expect(html).toContain('Confirm details and analyze')
  })
})
