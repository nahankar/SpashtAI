import type { Page } from 'playwright'
import type { ConversationEngine, StopReason } from '../engine/conversation.js'
import { BlockedError, pollUntil, wordRecall, type AdapterContext, type Check, type ExperienceAdapter } from './types.js'

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

  identifiers() { return { runId: this.runId, sessionId: this.sessionId } }

  async prepare(ctx: AdapterContext): Promise<void> {
    const { page, evidence, cfg } = ctx
    page.on('response', async res => {
      if (res.request().method() === 'POST' && /\/api\/interviews\/runs$/.test(new URL(res.url()).pathname) && res.ok()) {
        const body = await res.json().catch(() => null) as { id?: string; sessionId?: string } | null
        if (body?.id) { this.runId = body.id; this.sessionId = body.sessionId ?? null; evidence.event('app', 'interview_run_created', { runId: body.id, sessionId: body.sessionId }) }
      }
    })
    await page.goto(new URL('/interviews', cfg.targetUrl).toString())
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
      throw new Error('No audio track from the interviewer arrived within 90 s (room, agent or dispatch problem).')
    }
    evidence.event('browser', 'interviewer_audio_track_received')
    await ctx.screenshot('interview-connected')
  }

  private async closeUnfinished(ctx: AdapterContext): Promise<void> {
    const runs = await ctx.api.get<{ runs: Array<{ id: string; endedAt: string | null }> }>('/api/interviews/runs')
    const open = runs.body?.runs.find(r => !r.endedAt)
    if (!open) return
    ctx.evidence.event('tool', 'closing_unfinished_interview', { runId: open.id })
    await ctx.page.goto(new URL(`/interviews?run=${encodeURIComponent(open.id)}`, ctx.cfg.targetUrl).toString())
    const end = ctx.page.getByRole('button', { name: 'End practice' }).first()
    await pollUntil(async () => await end.isEnabled().catch(() => false), 60_000, 1000)
    await end.click()
    await ctx.page.getByRole('link', { name: /Review recordings and technical feedback/ }).waitFor({ timeout: 60_000 })
    await ctx.page.goto(new URL('/interviews', ctx.cfg.targetUrl).toString())
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
    const add = (c: Check) => { checks.push(c); ctx.evidence.event('verify', c.name, { status: c.status, required: c.required, basis: c.basis, detail: c.detail }) }
    if (!this.runId) { add({ name: 'interview_run_identified', status: 'failed', required: true, basis: 'browser', detail: 'No run id was observed' }); return checks }
    const runRes = await ctx.api.get<Run>(`/api/interviews/runs/${encodeURIComponent(this.runId)}`)
    const run = runRes.body
    if (!run) { add({ name: 'interview_run_readable', status: 'failed', required: true, basis: 'api', detail: `HTTP ${runRes.status}` }); return checks }
    this.sessionId ??= run.sessionId
    ctx.evidence.writeJson('app-interview-run.json', run)
    const wantedMinutes = ctx.cfg.interviewMinutes
    add({ name: 'practice_settings_applied', status: run.durationMinutes === wantedMinutes ? 'passed' : 'failed', required: true, basis: 'api',
      detail: `requested ${wantedMinutes} min; run stored ${run.durationMinutes === null ? 'no time limit' : `${run.durationMinutes} min`} (track ${run.track}, experience ${run.experienceBand}, difficulty ${run.startingDifficulty})` })
    add({ name: 'practice_ended', status: run.endedAt ? 'passed' : 'failed', required: true, basis: 'api', detail: run.endedAt ? `endedAt ${run.endedAt}` : 'run has no endedAt' })
    const answered = run.attempts.filter(a => a.status === 'ANSWERED' && a.capturedText.trim())
    add({ name: 'answers_captured_by_app', status: answered.length ? 'passed' : 'failed', required: true, basis: 'api',
      detail: `${answered.length} answered attempt(s) with app transcript; statuses: ${run.attempts.map(a => a.status).join(', ')}` })
    const spoken = engine.turns.filter(t => t.spoken).map(t => t.spoken!).join(' ')
    const captured = run.attempts.map(a => a.capturedText).join(' ')
    const recall = wordRecall(spoken, captured)
    add({ name: 'app_transcript_matches_candidate_speech', status: recall >= 0.6 ? 'passed' : 'failed', required: false, basis: 'api',
      detail: `${Math.round(recall * 100)}% of the candidate's content words appear in the app's transcript (advisory; ASR differences expected)` })
    const askedTexts = run.attempts.filter(a => a.status !== 'PREPARED').map(a => a.question.text)
    const heardAll = engine.transcripts.map(t => t.text).join(' ')
    const questionRecall = askedTexts.length ? askedTexts.reduce((n, q) => n + wordRecall(q, heardAll), 0) / askedTexts.length : 0
    add({ name: 'independent_recognition_matches_questions', status: questionRecall >= 0.6 ? 'passed' : 'failed', required: false, basis: 'audio',
      detail: `${Math.round(questionRecall * 100)}% of saved question words were independently recognized from the interviewer audio (advisory)` })

    const history = await ctx.api.get<{ runs: Array<{ id: string }> }>('/api/interviews/runs')
    const listed = Boolean(history.body?.runs.some(r => r.id === this.runId))
    add({ name: 'history_entry_api', status: listed ? 'passed' : 'failed', required: true, basis: 'api', detail: listed ? 'run listed by /api/interviews/runs' : 'run missing from history API' })
    await ctx.page.goto(new URL('/interviews/history', ctx.cfg.targetUrl).toString())
    const link = ctx.page.locator(`a[href*="${run.sessionId}"], a[href*="${this.runId}"]`).first()
    const shown = await link.waitFor({ timeout: 20_000 }).then(() => true, () => false)
    await ctx.screenshot('interview-history')
    add({ name: 'history_entry_displayed', status: shown ? 'passed' : 'failed', required: true, basis: 'browser', detail: shown ? 'Interview history shows the practice' : 'practice not found on /interviews/history' })

    const recording = await pollUntil(async () => {
      const r = await ctx.api.get(`/sessions/${encodeURIComponent(run.sessionId)}/recording/stream`, { Range: 'bytes=0-0' })
      return r.status === 200 || r.status === 206 ? r.status : null
    }, ctx.cfg.verifyTimeoutMs, 5000)
    add({ name: 'recording_available', status: recording ? 'passed' : 'pending', required: true, basis: 'api', detail: recording ? `recording stream HTTP ${recording}` : `no recording within ${ctx.cfg.verifyTimeoutMs / 1000} s` })

    if (run.evaluationEnabled) {
      const assessments = await pollUntil(async () => {
        const r = await ctx.api.get<{ assessments: unknown[] }>(`/api/interviews/runs/${encodeURIComponent(this.runId!)}/assessments`)
        return r.body?.assessments?.length ? r.body.assessments : null
      }, ctx.cfg.verifyTimeoutMs, 5000)
      if (assessments) ctx.evidence.writeJson('app-interview-assessments.json', assessments)
      add({ name: 'evaluation_available', status: assessments ? 'passed' : 'pending', required: true, basis: 'api',
        detail: assessments ? `${assessments.length} assessment(s) produced (existence only; scores are not judged)` : `no assessment within ${ctx.cfg.verifyTimeoutMs / 1000} s` })
    } else add({ name: 'evaluation_available', status: 'skipped', required: false, basis: 'api', detail: 'evaluation not enabled for this run' })

    await ctx.page.goto(new URL(`/interviews/playback/${encodeURIComponent(run.sessionId)}`, ctx.cfg.targetUrl).toString())
    const player = await ctx.page.locator('audio').first().waitFor({ state: 'attached', timeout: 30_000 }).then(() => true, () => false)
    await ctx.page.waitForTimeout(3000)
    await ctx.screenshot('interview-playback')
    const empty = await visible(ctx.page, /No playback available/)
    add({ name: 'playback_page_displayed', status: player && !empty ? 'passed' : 'failed', required: false, basis: 'browser',
      detail: empty ? 'playback page shows "No playback available"' : player ? 'playback page rendered an audio player' : 'no audio player on the playback page' })
    return checks
  }
}
