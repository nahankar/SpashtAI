import { navigateProduct } from '../browser/navigation.js'
import type { Page } from 'playwright'
import type { ConversationEngine, StopReason } from '../engine/conversation.js'
import { getScenario, SKIP_REPLY, type ManualStep, type Scenario } from '../candidate/scenarios.js'
import { verifyBrowserPlayback, verifySavedRecording } from '../recording.js'
import { AttributedError, BlockedError, pollUntil, wordRecall, type AdapterContext, type Check, type ExperienceAdapter } from './types.js'

const COMPLETION = [
  { re: /Practice time is up\. End practice to review your answers\./, reason: 'PRACTICE_DURATION_REACHED' },
  { re: /You have answered every available question for this selection\./, reason: 'QUESTION_BANK_EXHAUSTED' },
  { re: /This practice has no more questions\./, reason: 'PRACTICE_QUESTION_LIMIT' },
]
const STALLED = /Automatic progression has stopped\./

interface Attempt { id: string; index: number; status: string; capturedText: string; completionReason: string | null; question: { text: string } }
interface Run { id: string; sessionId: string; endedAt: string | null; attempts: Attempt[]; evaluationEnabled?: boolean; conversationMode?: boolean; durationMinutes: number | null; track: string; experienceBand: string; startingDifficulty: string }

async function visible(page: Page, re: RegExp): Promise<boolean> {
  return await page.getByText(re).first().isVisible().catch(() => false)
}

export async function activateAudio(ctx: AdapterContext): Promise<void> {
  const button = ctx.page.getByRole('button', { name: /Click to enable coach audio/i })
  if (await button.isVisible().catch(() => false)) {
    await button.click()
    ctx.evidence.event('browser', 'audio_activation_clicked', { control: 'Click to enable coach audio' })
  }
}

export class InterviewAdapter implements ExperienceAdapter {
  readonly name = 'interview'
  private runId: string | null = null
  private sessionId: string | null = null
  private stalledSeen = false
  private setup: Record<string, string> = {}
  private savedMode: boolean | undefined
  /** What the learner did through the UI in manual mode, with the outcome the page showed. */
  readonly controlLog: Array<{ turn: number; step: ManualStep; actions: string[]; outcome: string; ok: boolean }> = []
  private readonly scenario: Scenario | null

  constructor(scenarioId?: string) { this.scenario = scenarioId ? getScenario(scenarioId) : null }

  identifiers() { return { runId: this.runId, sessionId: this.sessionId } }

  mode(): 'automatic' | 'manual' | 'unknown' {
    return this.savedMode === undefined ? 'unknown' : this.savedMode ? 'automatic' : 'manual'
  }

  private get plan(): ManualStep[] | null {
    return this.scenario?.interviewMode === 'manual' ? this.scenario.manualPlan ?? null : null
  }

  scriptedReply(turn: number): string | null {
    return this.plan?.[turn - 1] === 'skip-next' ? SKIP_REPLY : null
  }

  /**
   * Manual flow after a spoken reply: the learner pauses briefly, then uses the page's own controls
   * (Finish answer / Skip question, then Next question or End practice). Outcomes are read from the page.
   */
  async afterCandidateTurn(ctx: AdapterContext, turn: number): Promise<{ action: 'continue' } | { action: 'stop'; reason: StopReason }> {
    const plan = this.plan
    if (!plan) return { action: 'continue' }
    const step = plan[turn - 1]
    if (!step) return { action: 'stop', reason: { kind: 'plan_complete', detail: `manual plan of ${plan.length} step(s) completed` } }
    const { page, evidence } = ctx
    const entry = { turn, step, actions: [] as string[], outcome: '', ok: false }
    this.controlLog.push(entry)
    // Let the last words reach the recognizer before sealing the answer, as a person would.
    await page.waitForTimeout(1500)
    const control = step === 'skip-next' ? 'Skip question' : 'Finish answer'
    const button = page.getByRole('button', { name: control, exact: true })
    if (!await pollUntil(async () => await button.isEnabled().catch(() => false), 20_000, 500)) {
      entry.outcome = `${control} was not enabled`
      await ctx.screenshot(`manual-${turn}-control-disabled`)
      return { action: 'stop', reason: { kind: 'error', detail: `manual step ${turn}: ${control} stayed disabled`, source: 'application' } }
    }
    await button.click()
    entry.actions.push(control)
    evidence.event('browser', 'manual_control_clicked', { turn, control })
    const wanted = step === 'skip-next' ? 'SKIPPED' : 'ANSWERED'
    const outcome = await pollUntil(async () => {
      const text = await page.evaluate(() => document.body.innerText).catch(() => '')
      if (/Your answer is saved\. Continue with another question or end practice\./.test(text) || await page.getByRole('button', { name: 'Next question' }).isVisible().catch(() => false)) return 'saved'
      // allTextContents() does not wait; a missing alert must not stall the poll.
      const alert = (await page.locator('[role=alert]').allTextContents().catch(() => [])).join(' ').trim() || null
      if (alert && /could not|unavailable|still being transcribed|Retry/i.test(alert)) return `error: ${alert.trim().slice(0, 200)}`
      const notice = await page.getByText(/No answer has been heard for this question yet/).first().isVisible().catch(() => false)
      return notice ? 'error: the app reported that no answer was heard' : null
    }, 60_000, 1000)
    await ctx.screenshot(`manual-${turn}-${wanted.toLowerCase()}`)
    if (outcome !== 'saved') {
      entry.outcome = outcome ?? `no saved state within 60 s after ${control}`
      return { action: 'stop', reason: { kind: 'error', detail: `manual step ${turn} (${control}): ${entry.outcome}`, source: 'application' } }
    }
    entry.outcome = `page shows the answer saved (${wanted.toLowerCase()})`
    if (step === 'finish-end') {
      entry.ok = true
      return { action: 'stop', reason: { kind: 'plan_complete', detail: `manual plan completed: ${plan.join(' → ')}` } }
    }
    const next = page.getByRole('button', { name: 'Next question' })
    if (!await pollUntil(async () => await next.isEnabled().catch(() => false), 20_000, 500)) {
      const message = await page.locator('[role=status]').allTextContents().catch(() => [])
      const done = message.find(m => /answered every|no more questions|duration reached|completed the questions/i.test(m))
      entry.outcome += done ? `; Next unavailable: ${done.trim()}` : '; Next question did not become available'
      if (done) return { action: 'stop', reason: { kind: 'natural', detail: `the app ended the question sequence: ${done.trim()}` } }
      return { action: 'stop', reason: { kind: 'error', detail: `manual step ${turn}: Next question not available after saving`, source: 'application' } }
    }
    await next.click()
    entry.actions.push('Next question')
    evidence.event('browser', 'manual_control_clicked', { turn, control: 'Next question' })
    entry.ok = true
    return { action: 'continue' }
  }

  async prepare(ctx: AdapterContext): Promise<void> {
    const { page, evidence, cfg } = ctx
    page.on('response', async res => {
      if (res.request().method() === 'POST' && /\/api\/interviews\/runs$/.test(new URL(res.url()).pathname) && res.ok()) {
        const body = await res.json().catch(() => null) as { id?: string; sessionId?: string } | null
        if (body?.id) { this.runId = body.id; this.sessionId = body.sessionId ?? null; evidence.event('app', 'interview_run_created', { runId: body.id, sessionId: body.sessionId }) }
      }
    })
    await navigateProduct(page, cfg, '/interviews')
    evidence.event('browser', 'navigated', { path: '/interviews' })
    if (/\/auth\//.test(new URL(page.url()).pathname)) throw new BlockedError('The browser session is not signed in. Run the login command for this target first.')
    await page.getByRole('heading', { name: 'Interviews', exact: true }).waitFor({ timeout: 30_000 })
    await page.getByText('Loading practice options…').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined)
    await ctx.screenshot('interview-setup')
    if (await visible(page, /Practice becomes available once your pilot access/)) throw new BlockedError('Interview practice is not available to this account (pilot access or voice pipeline not enabled).')
    if (await visible(page, /No reviewed questions are ready for this selection/)) throw new BlockedError('No reviewed interview questions match the default selection.')
    if (await visible(page, /Resume or end your unfinished interview below/)) {
      if (!cfg.closeUnfinished) throw new BlockedError('An unfinished interview exists for this account. End it in the UI or re-run with --close-unfinished.')
      await this.closeUnfinished(ctx)
    }

    const time = page.getByLabel('Practice time')
    const wanted = String(cfg.interviewMinutes)
    // The page resets practice time to the plan default when its options request resolves; select only once the
    // value has stayed put, and re-check immediately before Start.
    const chooseTime = async () => {
      const allowed = await time.locator('option').evaluateAll(opts => opts.map(o => (o as HTMLOptionElement).value))
      if (!allowed.includes(wanted)) { evidence.event('tool', 'practice_time_unavailable', { wanted, allowed }); return false }
      if (await time.inputValue() !== wanted) await time.selectOption(wanted)
      return true
    }
    await page.waitForLoadState('networkidle').catch(() => undefined)
    if (await chooseTime()) {
      await page.waitForTimeout(1000)
      await chooseTime()
    }
    this.setup = { practiceTime: await time.evaluate(s => (s as HTMLSelectElement).selectedOptions[0]?.textContent ?? '') }
    evidence.event('browser', 'interview_configured', this.setup)

    const ack = page.getByRole('button', { name: 'I agree' })
    if (await ack.isVisible().catch(() => false)) { await ack.click(); evidence.event('browser', 'recording_acknowledgment_accepted') }
    const consent = page.getByRole('checkbox')
    if (await page.getByText(/I agree to my answers being recorded/).isVisible().catch(() => false)) {
      await consent.check(); evidence.event('browser', 'recording_consent_checked')
    }
    const expectedMode = this.scenario?.interviewMode
    if (expectedMode) {
      const options = await ctx.api.get<{ conversationAvailable?: boolean }>('/api/interviews/options')
      const automaticAvailable = options.body?.conversationAvailable === true
      evidence.event('app', 'interview_mode_available', { automaticConversation: automaticAvailable })
      if ((expectedMode === 'automatic') !== automaticAvailable) {
        throw new BlockedError(`Scenario ${this.scenario!.id} needs ${expectedMode} Interview mode, but this account ${automaticAvailable ? 'has' : 'does not have'} automatic conversation access. ` +
          (expectedMode === 'manual' ? 'Use a dedicated account without interview_conversation access (README: manual Interview account).' : 'Use an account with interview_conversation access.'))
      }
    }
    const start = page.getByRole('button', { name: 'Start practice' })
    await start.waitFor({ timeout: 15_000 })
    await pollUntil(async () => await start.isEnabled(), 15_000, 500)
    if (!await start.isEnabled()) throw new BlockedError('Start practice stayed disabled (recording notice, coverage or an unfinished practice).')
    await chooseTime()
    this.setup = { practiceTime: await time.evaluate(s => (s as HTMLSelectElement).selectedOptions[0]?.textContent ?? '') }
    evidence.event('browser', 'interview_start_settings', this.setup)
    await ctx.screenshot('interview-before-start')
    const tracksBefore = ctx.bridge.incomingStreamCount()
    await start.click()
    evidence.event('browser', 'start_clicked', { control: 'Start practice' })
    await page.waitForURL(/[?&]run=/, { timeout: 60_000 })
    this.runId ??= new URL(page.url()).searchParams.get('run')
    const joined = await pollUntil(async () => { await activateAudio(ctx); return ctx.bridge.incomingStreamCount() > tracksBefore }, 90_000, 1000)
    if (!joined) {
      await ctx.screenshot('interview-no-audio')
      throw new AttributedError('No audio track from the interviewer arrived within 90 s (agent worker, dispatch or LiveKit targeting).', 'setup')
    }
    evidence.event('browser', 'interviewer_audio_track_received')
    await ctx.screenshot('interview-connected')
    const automatic = await page.getByText(/^Automatic conversation: after you finish/).first().isVisible().catch(() => false)
    evidence.event('browser', 'interview_mode_displayed', { mode: automatic ? 'automatic' : 'manual' })
    const expected = this.scenario?.interviewMode
    if (expected && (expected === 'automatic') !== automatic) {
      // Do not leave a practice running: end it through the UI, then report the setup mismatch.
      await this.finish(ctx, { kind: 'cancelled', detail: 'interview mode mismatch' }).catch(() => undefined)
      throw new BlockedError(`Scenario ${this.scenario!.id} needs ${expected} Interview mode, but this account's practice started in ${automatic ? 'automatic conversation' : 'manual'} mode. ` +
        (expected === 'manual' ? 'Use an account without interview_conversation access (see README: manual Interview account).' : 'Use an account with interview_conversation access.'))
    }
  }

  private async closeUnfinished(ctx: AdapterContext): Promise<void> {
    const runs = await ctx.api.get<{ runs: Array<{ id: string; endedAt: string | null }> }>('/api/interviews/runs')
    const open = runs.body?.runs.find(r => !r.endedAt)
    if (!open) return
    ctx.evidence.event('tool', 'closing_unfinished_interview', { runId: open.id })
    await navigateProduct(ctx.page, ctx.cfg, `/interviews?run=${encodeURIComponent(open.id)}`)
    const end = ctx.page.getByRole('button', { name: 'End practice' }).first()
    await pollUntil(async () => await end.isEnabled().catch(() => false), 60_000, 1000)
    await end.click()
    await ctx.page.getByRole('link', { name: /Review recordings and technical feedback/ }).waitFor({ timeout: 60_000 })
    await navigateProduct(ctx.page, ctx.cfg, '/interviews')
    await ctx.page.getByRole('button', { name: 'Start practice' }).waitFor({ timeout: 30_000 })
  }

  async completion(ctx: AdapterContext) {
    // One read of the visible text per poll keeps the trace small (each locator query is a traced action).
    const text = await ctx.page.evaluate(() => document.body.innerText).catch(() => '')
    for (const c of COMPLETION) if (c.re.test(text)) return { complete: true, reason: c.reason }
    if (!this.stalledSeen && STALLED.test(text)) {
      this.stalledSeen = true
      ctx.evidence.event('browser', 'interview_progression_stalled', { text: 'Automatic progression has stopped.' })
      await ctx.screenshot('interview-stalled')
    }
    return { complete: false }
  }

  async finish(ctx: AdapterContext, stop: StopReason): Promise<{ ended: boolean; detail: string }> {
    const { page, evidence } = ctx
    await ctx.screenshot(`interview-before-end-${stop.kind}`)
    const end = page.getByRole('button', { name: 'End practice' }).first()
    const enabled = await pollUntil(async () => await end.isEnabled().catch(() => false), 45_000, 1000)
    let path = 'End practice'
    if (enabled) await end.click()
    else {
      const fallback = page.getByRole('button', { name: 'End without waiting' })
      if (!await fallback.isVisible().catch(() => false)) return { ended: false, detail: 'End practice stayed disabled and no fallback control was offered' }
      await fallback.click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'End practice' }).click()
      path = 'End without waiting → End practice'
    }
    evidence.event('browser', 'end_clicked', { control: path })
    const done = await page.getByRole('link', { name: /Review recordings and technical feedback in playback/ }).waitFor({ timeout: 90_000 }).then(() => true, () => false)
    await ctx.screenshot('interview-ended')
    return { ended: done, detail: done ? `ended via "${path}"` : `clicked "${path}" but the ended state was not shown within 90 s` }
  }

  async verify(ctx: AdapterContext, engine: ConversationEngine): Promise<Check[]> {
    const checks: Check[] = []
    const add = (c: Check) => { checks.push(c); ctx.evidence.event('verify', c.name, { status: c.status, required: c.required, basis: c.basis, area: c.area, detail: c.detail }) }
    if (!this.runId) { add({ name: 'interview_run_identified', status: 'failed', required: true, basis: 'browser', area: 'app-data', detail: 'No run id was observed' }); return checks }
    const runRes = await ctx.api.get<Run>(`/api/interviews/runs/${encodeURIComponent(this.runId)}`)
    const run = runRes.body
    if (!run) { add({ name: 'interview_run_readable', status: 'failed', required: true, basis: 'api', area: 'app-data', detail: `HTTP ${runRes.status}` }); return checks }
    this.sessionId ??= run.sessionId
    this.savedMode = run.conversationMode === true
    ctx.evidence.writeJson('app-interview-run.json', run)

    const expected = this.scenario?.interviewMode
    add({ name: 'interview_mode_exercised', status: !expected || (expected === 'automatic') === this.savedMode ? 'passed' : 'failed', required: true, basis: 'api', area: 'mode', attribution: 'setup',
      detail: `run saved as ${this.savedMode ? 'automatic conversation' : 'manual'} mode${expected ? `; scenario certifies ${expected} mode` : ''}` })
    const wantedMinutes = ctx.cfg.interviewMinutes
    add({ name: 'practice_settings_applied', status: run.durationMinutes === wantedMinutes ? 'passed' : 'failed', required: true, basis: 'api', area: 'setup', attribution: 'tool',
      detail: `requested ${wantedMinutes} min; run stored ${run.durationMinutes === null ? 'no time limit' : `${run.durationMinutes} min`} (track ${run.track}, experience ${run.experienceBand}, difficulty ${run.startingDifficulty})` })
    add({ name: 'practice_ended', status: run.endedAt ? 'passed' : 'failed', required: true, basis: 'api', area: 'app-data', detail: run.endedAt ? `endedAt ${run.endedAt}` : 'run has no endedAt' })
    const asked = run.attempts.filter(a => a.status !== 'PREPARED')
    const answered = run.attempts.filter(a => a.status === 'ANSWERED' && a.capturedText.trim())
    add({ name: 'answers_captured_by_app', status: answered.length ? 'passed' : 'failed', required: true, basis: 'api', area: 'app-data',
      detail: `${answered.length} answered attempt(s) with app transcript; statuses: ${run.attempts.map(a => a.status).join(', ') || 'none'}` })

    const plan = this.plan
    if (plan) {
      const expectedStatuses = plan.map(step => (step === 'skip-next' ? 'SKIPPED' : 'ANSWERED'))
      const actual = asked.slice(0, plan.length).map(a => a.status)
      const ok = expectedStatuses.every((st, i) => actual[i] === st) && this.controlLog.length === plan.length && this.controlLog.every(c => c.ok)
      add({ name: 'manual_controls_outcomes', status: ok ? 'passed' : 'failed', required: true, basis: 'api', area: 'mode',
        detail: `plan ${plan.join(' → ')}; UI: ${this.controlLog.map(c => `turn ${c.turn} ${c.actions.join(' + ') || 'no click'} → ${c.outcome}`).join('; ') || 'no controls used'}; saved statuses ${actual.join(', ') || 'none'} (expected ${expectedStatuses.join(', ')})` })
      add({ name: 'manual_flow_covered_questions', status: asked.length >= 2 && this.controlLog.some(c => c.actions.includes('Next question')) && this.controlLog.some(c => c.actions.includes('Skip question')) && this.controlLog.some(c => c.actions.includes('Finish answer')) ? 'passed' : 'failed',
        required: true, basis: 'browser', area: 'mode', detail: `${asked.length} question(s) asked; controls used: ${[...new Set(this.controlLog.flatMap(c => c.actions))].join(', ') || 'none'}` })
    }

    // Per reply: is what the candidate said in the app's saved answers? Scripted skip requests are excluded.
    const captured = run.attempts.map(a => a.capturedText).join(' ')
    const answers = engine.turns.filter(t => t.spoken && !(plan && this.scriptedReply(engineTurnIndex(engine, t)) !== null))
    for (const t of answers) t.savedRecall = Math.max(0, ...run.attempts.map(a => wordRecall(t.spoken!, a.capturedText)))
    const missing = answers.filter(t => (t.savedRecall ?? 0) < 0.3)
    add({ name: 'saved_answers_cover_spoken_replies', status: answers.length && !missing.length ? 'passed' : 'failed', required: true, basis: 'api', area: 'app-data',
      detail: answers.length ? `${answers.length - missing.length}/${answers.length} spoken answers found in saved answers` + (missing.length ? `; potentially missing: ${missing.map(t => `turn ${t.turn} (${Math.round((t.savedRecall ?? 0) * 100)}%, ${((t.micTrackVoicedMs ?? 0) / 1000).toFixed(1)} s on the app mic track)`).join(', ')}` : '') : 'no spoken answers' })
    const spoken = answers.map(t => t.spoken!).join(' ')
    add({ name: 'app_transcript_matches_candidate_speech', status: wordRecall(spoken, captured) >= 0.6 ? 'passed' : 'failed', required: false, basis: 'api', area: 'app-data',
      detail: `${Math.round(wordRecall(spoken, captured) * 100)}% of the candidate's content words appear in the app's transcript (advisory; ASR differences expected)` })
    const heardAll = engine.transcripts.map(t => t.text).join(' ')
    const questionRecall = asked.length ? asked.reduce((n, a) => n + wordRecall(a.question.text, heardAll), 0) / asked.length : 0
    add({ name: 'independent_recognition_matches_questions', status: questionRecall >= 0.6 ? 'passed' : 'failed', required: false, basis: 'audio', area: 'live-audio',
      detail: `${Math.round(questionRecall * 100)}% of saved question words were independently recognized from the interviewer audio (advisory)` })

    const history = await ctx.api.get<{ runs: Array<{ id: string }> }>('/api/interviews/runs')
    const listed = Boolean(history.body?.runs.some(r => r.id === this.runId))
    add({ name: 'history_entry_api', status: listed ? 'passed' : 'failed', required: true, basis: 'api', area: 'app-data', detail: listed ? 'run listed by /api/interviews/runs' : 'run missing from history API' })
    await navigateProduct(ctx.page, ctx.cfg, '/interviews/history')
    const link = ctx.page.locator(`a[href*="${run.sessionId}"], a[href*="${this.runId}"]`).first()
    const shown = await link.waitFor({ timeout: 20_000 }).then(() => true, () => false)
    await ctx.screenshot('interview-history')
    add({ name: 'history_entry_displayed', status: shown ? 'passed' : 'failed', required: true, basis: 'browser', area: 'app-data', detail: shown ? 'Interview history shows the practice' : 'practice not found on /interviews/history' })

    const expectedVoiced = engine.turns.reduce((n, t) => n + (t.micTrackVoicedMs ?? 0), 0)
    for (const c of await verifySavedRecording(ctx, run.sessionId, answers.map(t => t.spoken!), expectedVoiced)) add(c)

    if (run.evaluationEnabled) {
      const assessments = await pollUntil(async () => {
        const r = await ctx.api.get<{ assessments: unknown[] }>(`/api/interviews/runs/${encodeURIComponent(this.runId!)}/assessments`)
        return r.body?.assessments && r.body.assessments.length >= answered.length && r.body.assessments.length ? r.body.assessments : null
      }, ctx.cfg.verifyTimeoutMs, 5000)
      const partial = assessments ? null : (await ctx.api.get<{ assessments: unknown[] }>(`/api/interviews/runs/${encodeURIComponent(this.runId!)}/assessments`)).body?.assessments ?? []
      if (assessments ?? partial) ctx.evidence.writeJson('app-interview-assessments.json', assessments ?? partial)
      add({ name: 'feedback_available', status: assessments ? 'passed' : 'pending', required: true, basis: 'api', area: 'app-data',
        detail: assessments ? `${assessments.length} assessment(s) for ${answered.length} answered question(s) (existence only; scores are not judged)` : `${partial?.length ?? 0} of ${answered.length} expected assessment(s) after ${ctx.cfg.verifyTimeoutMs / 1000} s (processing pending)` })
    } else add({ name: 'feedback_available', status: 'skipped', required: false, basis: 'api', area: 'app-data', detail: 'evaluation not enabled for this run' })

    await navigateProduct(ctx.page, ctx.cfg, `/interviews/playback/${encodeURIComponent(run.sessionId)}`)
    add(await verifyBrowserPlayback(ctx.page))
    await ctx.screenshot('interview-playback')
    return checks
  }
}

/** 1-based candidate-turn number of a spoken record (matches the numbering used by scripted replies). */
function engineTurnIndex(engine: ConversationEngine, turn: { turn: number }): number {
  return engine.turns.filter(t => t.spoken).findIndex(t => t.turn === turn.turn) + 1
}
