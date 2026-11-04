import type { Check } from '../adapters/types.js'
import type { StopReason, TurnRecord } from '../engine/conversation.js'
import { provenanceLabel, type ComponentProvenance } from '../provenance.js'

export type Outcome = 'passed' | 'failed' | 'blocked' | 'inconclusive'

export interface RunReport {
  runId: string
  outcome: Outcome
  outcomeReasons: string[]
  startedAt: string
  endedAt: string
  durationMs: number
  target: string
  targetKind: string
  workspace?: string
  experience: string
  scenario: string
  profile: string
  /** Revision of this test tool only. Never the application revision. */
  tool: { version: string; commit: string; dirty: boolean }
  /** What application code was tested, per component, with verification status. */
  application: ComponentProvenance[]
  /** Interview interaction mode actually exercised (from the saved run), when applicable. */
  interviewMode?: 'automatic' | 'manual' | 'unknown'
  failureSources: FailureSource[]
  /** Observable state when the conversation stopped (failure evidence). */
  atStop?: Record<string, unknown>
  providers: Record<string, string>
  identifiers: Record<string, string | null>
  stop: StopReason | null
  finish: { ended: boolean; detail: string } | null
  checks: Check[]
  turns: TurnRecord[]
  independentTranscript: Array<{ id: string; tMs: number; text: string; error?: string }>
  timings: Record<string, { count: number; min: number; median: number; max: number } | null>
  providerRequests: Record<string, number>
  artifacts: Array<{ file: string; description: string }>
  missingEvidence: string[]
  errors: string[]
  limitations: string[]
}

export type FailureSource = 'application' | 'tool' | 'setup' | 'unknown'

export interface Classification { outcome: Outcome; reasons: string[]; sources: FailureSource[] }

/**
 * Outcome rules. Only a session the application (or, for the manual scenario, the scripted learner plan)
 * completed, ended through the UI, with every required check passed, is `passed`. Each failure reason names
 * whether it points at the application, the tool, or the setup, so application defects are never masked.
 */
export function classify(input: { blocked?: string; blockedSource?: FailureSource; stop: StopReason | null; stopSource?: FailureSource;
  finish: { ended: boolean; detail: string } | null; checks: Check[] }): Classification {
  if (input.blocked) return { outcome: 'blocked', reasons: [`[${input.blockedSource ?? 'setup'}] ${input.blocked}`], sources: [input.blockedSource ?? 'setup'] }
  const reasons: string[] = []
  const sources = new Set<FailureSource>()
  const add = (source: FailureSource, text: string) => { sources.add(source); reasons.push(`[${source}] ${text}`) }
  const failedRequired = input.checks.filter(c => c.required && c.status === 'failed')
  const pendingRequired = input.checks.filter(c => c.required && c.status === 'pending')
  if (input.stop?.kind === 'error') add(input.stopSource ?? 'tool', `conversation error: ${input.stop.detail}`)
  if (input.stop?.kind === 'timeout') add(input.stopSource ?? 'unknown', `whole-run timeout: ${input.stop.detail}`)
  if (input.stop?.kind === 'app_silent') add(input.stopSource ?? 'unknown', `SpashtAI went silent: ${input.stop.detail}`)
  if (input.finish && !input.finish.ended) add('application', `session did not end normally: ${input.finish.detail}`)
  for (const c of failedRequired) add(c.attribution ?? (c.basis === 'tool' ? 'tool' : 'application'), `required check failed: ${c.name} — ${c.detail}`)
  if (reasons.length) return { outcome: 'failed', reasons, sources: [...sources] }
  if (input.stop && (input.stop.kind === 'max_turns' || input.stop.kind === 'max_duration' || input.stop.kind === 'cancelled')) {
    add('tool', `bounded run: stopped by the tool (${input.stop.kind}: ${input.stop.detail}) before the application completed the session`)
  }
  for (const c of pendingRequired) add(c.attribution ?? 'application', `still pending after the verification window: ${c.name} — ${c.detail}`)
  if (!input.stop || !input.finish || !input.checks.some(c => c.required && c.status === 'passed')) {
    add('unknown', 'missing completion, session-end or required verification evidence')
  }
  for (const c of input.checks.filter(c => c.required && c.status === 'skipped')) add(c.attribution ?? 'setup', `required verification was skipped: ${c.name} — ${c.detail}`)
  if (reasons.length) return { outcome: 'inconclusive', reasons, sources: [...sources] }
  const how = input.stop?.kind === 'plan_complete' ? 'the scripted learner plan completed and the learner ended the session through the UI' : 'application completed the session naturally'
  return { outcome: 'passed', reasons: [`${how}; every required check passed`], sources: [] }
}

export function stats(values: Array<number | undefined>): { count: number; min: number; median: number; max: number } | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  return { count: v.length, min: Math.round(v[0]), median: Math.round(v[Math.floor(v.length / 2)]), max: Math.round(v[v.length - 1]) }
}

const fmt = (ms: number | undefined) => (typeof ms === 'number' ? `${(ms / 1000).toFixed(2)} s` : '—')

export function renderMarkdown(r: RunReport, t0: number): string {
  const lines: string[] = []
  const badge = { passed: 'PASSED', failed: 'FAILED', blocked: 'BLOCKED', inconclusive: 'INCONCLUSIVE' }[r.outcome]
  lines.push(`# Voice test candidate run ${r.runId}`, '', `**Result: ${badge}**`, '')
  for (const reason of r.outcomeReasons) lines.push(`- ${reason}`)
  lines.push('', '| Field | Value |', '|---|---|',
    `| Target | ${r.target} (${r.targetKind}) |`,
    `| Workspace | ${r.workspace ?? 'Personal'} |`,
    `| Experience / scenario / profile | ${r.experience} / ${r.scenario} / ${r.profile} |`,
    `| Started / duration | ${r.startedAt} / ${fmt(r.durationMs)} |`,
    ...(r.interviewMode ? [`| Interview mode exercised | ${r.interviewMode === 'manual' ? 'manual — Finish / Skip / Next through UI controls' : r.interviewMode === 'automatic' ? 'automatic conversation — the interviewer finishes answers and moves on' : 'unknown'} |`] : []),
    `| Test tool revision (not the app) | ${r.tool.version} @ ${r.tool.commit}${r.tool.dirty ? ' (uncommitted changes)' : ''} |`,
    ...Object.entries(r.providers).map(([k, v]) => `| ${k} | ${v} |`),
    ...Object.entries(r.identifiers).map(([k, v]) => `| ${k} | ${v ?? '—'} |`),
    `| Conversation stop | ${r.stop ? `${r.stop.kind}: ${r.stop.detail}` : '—'} |`,
    `| Session end | ${r.finish ? r.finish.detail : '—'} |`, '')

  if (r.failureSources.length) lines.push(`**Failure points at:** ${r.failureSources.join(', ')} (see bracketed reasons above).`, '')

  lines.push('## Application under test', '', 'Revision status: **verified** = a local process serves the endpoint and its source directory is clean at HEAD, unchanged since the process started; **unverified** = process found but the running code may differ (uncommitted changes, or the directory changed after the process started); **unknown** = not inspectable (remote or containerized). The test tool revision above is never the application revision.', '',
    '| Component | Endpoint | Status | Revision / source | Targets | Basis |', '|---|---|---|---|---|---|')
  for (const a of r.application) {
    const targets = a.targets ? Object.entries(a.targets).map(([k, v]) => `${k}=${v.value} (${v.source})`).join('<br>') : '—'
    lines.push(`| ${a.component}${a.pid ? ` (pid ${a.pid})` : ''} | ${a.endpoint ?? '—'} | ${a.status} | ${provenanceLabel(a).replace(/^[a-z]+: /, '')} | ${targets} | ${a.basis} |`)
  }
  lines.push('')

  if (r.atStop) {
    lines.push('## State when the conversation stopped', '')
    for (const [k, v] of Object.entries(r.atStop)) lines.push(`- **${k}:** ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    lines.push('')
  }

  lines.push('## Checks', '', 'Basis: **browser** = displayed in the test browser; **audio** = measured from captured audio; **api** = read-only API call with the test session (diagnostic, not user-visible); **tool** = tool state.', '',
    'Area: **live-audio** = audio exchanged during the session (captured in the test browser); **saved-recording** = the stored recording after the session; **app-data** = saved answers, transcripts, feedback, history; **mode** = interaction mode exercised. Physical speaker output is never covered.', '',
    '| Check | Status | Required | Area | Basis | Points at | Detail |', '|---|---|---|---|---|---|---|')
  for (const c of r.checks) lines.push(`| ${c.name} | ${c.status} | ${c.required ? 'yes' : 'advisory'} | ${c.area ?? '—'} | ${c.basis} | ${c.status === 'passed' ? '—' : c.attribution ?? (c.basis === 'tool' ? 'tool' : 'application')} | ${c.detail.replace(/\|/g, '/')} |`)

  lines.push('', '## Conversation', '', 'SpashtAI lines are the tool\'s **independent recognition of the audio**, not the app\'s transcript.', '')
  for (const t of r.turns) {
    lines.push(`### Turn ${t.turn} (SpashtAI speech ended at ${fmt(t.appSpeechEndEpoch - t0)})`, '', `**SpashtAI (heard):** ${t.heard}`, '')
    if (t.spoken) {
      lines.push(`**Candidate (spoken):** ${t.spoken}`, '')
      lines.push(`Response gap ${fmt(t.responseGapMs)} · SpashtAI responded after ${fmt(t.appResponseLatencyMs)} · mic open at start: ${t.micOpenAtStart ? 'yes' : 'no'}${t.stoppedEarly ? ' · stopped early (yielded)' : ''}`)
      lines.push(`On the app microphone track: ${t.micTrackVoicedMs === undefined ? 'not measured' : `${fmt(t.micTrackVoicedMs)} voiced`} · in the app's saved transcript: ${t.savedRecall === undefined ? 'not compared' : `${Math.round(t.savedRecall * 100)}% of its words${t.savedRecall < 0.3 ? ' — POTENTIALLY MISSING' : ''}`}`)
      const meta = t.audioMeta as { insertedPausesMs?: number[]; measuredPausesMs?: number[]; file?: string } | undefined
      if (meta?.insertedPausesMs?.length) lines.push(`Inserted pauses ${meta.insertedPausesMs.join(', ')} ms; measured in audio ${meta.measuredPausesMs?.join(', ') || 'none'} ms`)
      if (meta?.file) lines.push(`Audio: \`${meta.file}\``)
    } else lines.push(`**Candidate:** stayed silent (${t.suppressed ?? `decision: ${t.decision}`})`)
    if (t.deliberateSilenceMs) lines.push(`Deliberate silence ${fmt(t.deliberateSilenceMs)}; SpashtAI spoke during it: ${t.appSpokeDuringSilence ? 'yes' : 'no'}`)
    lines.push('')
  }

  lines.push('## Timings', '', 'Boundaries: SpashtAI speech start/end come from an energy VAD on the received audio (20 ms frames, end = last voiced frame before ≥ the configured end-silence); candidate start/end are the virtual-microphone playback start and end events. All are epoch times on this machine.', '',
    '| Measure | n | min | median | max |', '|---|---|---|---|---|')
  for (const [k, v] of Object.entries(r.timings)) lines.push(v ? `| ${k} | ${v.count} | ${fmt(v.min)} | ${fmt(v.median)} | ${fmt(v.max)} |` : `| ${k} | 0 | — | — | — |`)

  lines.push('', '## Provider requests', '', ...Object.entries(r.providerRequests).map(([k, v]) => `- ${k}: ${v}`))
  lines.push('', '## Artifacts', '', ...r.artifacts.map(a => `- \`${a.file}\` — ${a.description}`))
  if (r.missingEvidence.length) lines.push('', '## Missing evidence', '', ...r.missingEvidence.map(m => `- ${m}`))
  if (r.errors.length) lines.push('', '## Errors (sanitized)', '', ...r.errors.slice(0, 40).map(e => `- ${e.replace(/\n/g, ' ').slice(0, 400)}`))
  lines.push('', '## Coverage limits', '', ...r.limitations.map(l => `- ${l}`), '')
  return lines.join('\n')
}

export const LIMITATIONS = [
  'The microphone is a WebAudio stream substituted for getUserMedia inside the test browser. Physical microphones, device selection, OS permission prompts, echo cancellation on real hardware and room acoustics are not exercised.',
  'SpashtAI audio is tapped from the remote WebRTC track received by the browser, before the page\'s audio element. Speaker output and autoplay playback in the real element are only checked indirectly (activation button clicked when shown).',
  'Answer relevance and coaching quality are not judged; evaluation checks confirm that results exist, not that scores are correct.',
  'The browser video (when enabled) has no audio; audio evidence is in the separate WAV files listed above.',
]
