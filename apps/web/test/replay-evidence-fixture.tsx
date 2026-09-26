// Local acceptance fixture: no backend, account or personal media. Unmatched requests fail closed.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReplayEvidencePanel } from '../src/components/replay/ReplayEvidencePanel'
import type { ReplayEvidence } from '../src/components/replay/evidence-contract'
import '../src/index.css'

const input: ReplayEvidence = {
  version: 'replay-delivery-v1', transcriptRevision: 'synthetic-transcript', state: 'unavailable', reason: 'confirm_learner',
  coverage: 1, eligibleWords: 40, excludedWords: 0, recording: null,
  identity: { state: 'confirmation_required', speaker: null, revision: null },
  speakers: [{ speaker: 'spk_0', excerpt: 'I will send the plan tomorrow.', preview: null }, { speaker: 'spk_1', excerpt: 'Let us review the proposal.', preview: null }],
  source: 'synthetic fixture', accuracy: 'not_human_validated', measurement: 'Eligible learner stretches with internal gaps.',
  limitations: ['This local fixture uses synthetic data only.'], supplementaryTranscript: null,
  pace: { wpm: null, status: 'insufficient_evidence' }, moments: [],
}
let selected = ''
window.fetch = async (url, options) => {
  if (!String(url).endsWith('/api/replay/sessions/synthetic/learner') || options?.method !== 'PUT') throw new Error('Unexpected fixture request')
  const body = JSON.parse(String(options.body))
  selected = body.speaker
  return new Response(JSON.stringify({ code: 200 }), { headers: { 'Content-Type': 'application/json' } })
}
export function Fixture() {
  const [evidence, setEvidence] = useState(input)
  return <main className="max-w-3xl mx-auto p-8">
    <h1>Replay synthetic UI acceptance</h1>
    <ReplayEvidencePanel sessionId="synthetic" key={evidence.identity.revision} evidence={evidence} audioDisabled={true}
      onConfirmed={() => setEvidence({ ...input, reason: 'word_timing_missing_or_legacy', identity: { state: 'confirmed', speaker: selected, revision: selected } })} />
  </main>
}
createRoot(document.querySelector('#root')!).render(<Fixture />)
