import { navigateProduct } from '../browser/navigation.js'
import type { ConversationEngine, StopReason } from '../engine/conversation.js'
import { activateAudio } from './interview.js'
import { verifyBrowserPlayback, verifySavedRecording } from '../recording.js'
import { AttributedError, BlockedError, pollUntil, wordRecall, type AdapterContext, type Check, type ExperienceAdapter } from './types.js'

interface Turn { role?: string; speaker?: string; text?: string; content?: string }

/**
 * Elevate has no in-UI "exercise complete" signal: the coach announces the wrap-up by voice and the learner
 * chooses Leave. Completion is therefore the candidate's own reading of the coach's audio (as for a human),
 * recorded as such in the report.
 */
export class ElevateAdapter implements ExperienceAdapter {
  readonly name = 'elevate'
  private sessionId: string | null = null
  private sessionName = ''
  private engine: ConversationEngine | null = null

  identifiers() { return { sessionId: this.sessionId, sessionName: this.sessionName } }
  attach(engine: ConversationEngine) { this.engine = engine }

  async prepare(ctx: AdapterContext): Promise<void> {
    const { page, evidence, cfg } = ctx
    page.on('request', req => {
      if (req.method() !== 'POST' || !/\/sessions$/.test(new URL(req.url()).pathname) || this.sessionId) return
      try {
        const body = JSON.parse(req.postData() ?? '{}') as { id?: string; module?: string }
        if (body.id && body.module === 'elevate') { this.sessionId = body.id; evidence.event('app', 'elevate_session_created', { sessionId: body.id }) }
      } catch { /* not JSON */ }
    })
    await navigateProduct(page, cfg, '/elevate?newSession=true')
    evidence.event('browser', 'navigated', { path: '/elevate?newSession=true' })
    if (/\/auth\//.test(new URL(page.url()).pathname)) throw new BlockedError('The browser session is not signed in. Run the login command for this target first.')
    const create = page.getByRole('button', { name: /New Elevate Session/ })
    const name = page.getByPlaceholder('e.g. Interview Practice, Pitch Rehearsal')
    await Promise.race([create.waitFor({ timeout: 15000 }), name.waitFor({ timeout: 15000 })]).catch(() => undefined)
    if (await create.isVisible().catch(() => false)) await create.click()
    const ready = await name.waitFor({ timeout: 30_000 }).then(() => true, () => false)
    if (!ready) {
      await ctx.screenshot('elevate-setup-missing')
      throw new BlockedError('The Elevate session form did not appear (feature access or a session already in progress).')
    }
    await page.getByText('Checking for a practice in progress…').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined)
    this.sessionName = `Voice test ${evidence.runId.slice(-6)}`
    await name.fill(this.sessionName)
    const focus = page.locator('select').filter({ has: page.locator('option[value="clarity"]') }).first()
    const options = await focus.locator('option').evaluateAll(o => o.map(x => (x as HTMLOptionElement).value))
    if (!options.includes(cfg.elevateFocus)) throw new BlockedError(`Focus area "${cfg.elevateFocus}" is not offered (available: ${options.filter(Boolean).join(', ')})`)
    await focus.selectOption(cfg.elevateFocus)
    evidence.event('browser', 'elevate_configured', { sessionName: this.sessionName, focusArea: cfg.elevateFocus })
    await ctx.screenshot('elevate-setup')
    const start = page.getByRole('button', { name: 'Start Session' })
    await pollUntil(async () => await start.isEnabled(), 30_000, 500)
    const tracksBefore = ctx.bridge.incomingStreamCount()
    await start.click()
    evidence.event('browser', 'start_clicked', { control: 'Start Session' })
    // A leftover live take (e.g. from an interrupted earlier run) makes the app ask before ending it — the same
    // decision a learner makes. Confirm it only with --close-unfinished, and record it; never decide silently.
    let takeover: unknown = null
    const joined = await pollUntil(async () => {
      if (!takeover && await page.getByText('End the other live session?').isVisible().catch(() => false)) {
        if (!cfg.closeUnfinished) {
          takeover = new BlockedError('Another live Elevate session exists for this account in this workspace. End it in the UI or re-run with --close-unfinished.')
          return true
        }
        await ctx.screenshot('elevate-takeover-prompt')
        await page.getByRole('button', { name: 'Take over this session' }).click()
        evidence.event('browser', 'elevate_takeover_confirmed', { control: 'Take over this session' })
        takeover = true
      }
      await activateAudio(ctx)
      return ctx.bridge.incomingStreamCount() > tracksBefore
    }, 90_000, 1000)
    if (takeover instanceof BlockedError) throw takeover
    if (!joined) {
      await ctx.screenshot('elevate-no-audio')
      throw new AttributedError('No audio track from the coach arrived within 90 s (agent worker, dispatch or LiveKit targeting).', 'setup')
    }
    evidence.event('browser', 'coach_audio_track_received')
    await ctx.screenshot('elevate-connected')
  }

  async completion(_ctx: AdapterContext) {
    if (this.engine?.candidateThinksComplete) return { complete: true, reason: 'coach closed the exercise (recognized from the coach audio by the candidate)' }
    return { complete: false }
  }

  async finish(ctx: AdapterContext, stop: StopReason): Promise<{ ended: boolean; detail: string }> {
    const { page, evidence } = ctx
    await ctx.screenshot(`elevate-before-leave-${stop.kind}`)
    const leave = page.getByRole('button', { name: 'Leave', exact: true }).first()
    if (!await leave.isVisible().catch(() => false)) return { ended: false, detail: 'Leave control not visible' }
    await leave.click()
    evidence.event('browser', 'end_clicked', { control: 'Leave' })
    const results = await page.getByRole('tab', { name: /Playback/ }).waitFor({ timeout: 120_000 }).then(() => true, () => false)
    await ctx.screenshot('elevate-results')
    this.sessionId ??= new URL(page.url()).searchParams.get('session')
    return { ended: results, detail: results ? 'left via "Leave"; results view displayed' : 'clicked "Leave" but the results view did not appear within 120 s' }
  }

  async verify(ctx: AdapterContext, engine: ConversationEngine): Promise<Check[]> {
    const checks: Check[] = []
    const add = (c: Check) => { checks.push(c); ctx.evidence.event('verify', c.name, { status: c.status, required: c.required, basis: c.basis, area: c.area, detail: c.detail }) }
    // The results view opens on Playback after Leave: verify the browser player before navigating away.
    add(await verifyBrowserPlayback(ctx.page))
    await ctx.screenshot('elevate-playback')
    const id = this.sessionId
    if (!id) { add({ name: 'elevate_session_identified', status: 'failed', required: true, basis: 'browser', area: 'app-data', detail: 'no session id observed' }); return checks }

    type SessionView = { endedAt?: string | null; paceReconciliationStatus?: string | null; deliveryAlignmentStatus?: string | null }
    const readSession = async () => {
      const r = await ctx.api.get<{ session?: SessionView } & SessionView>(`/sessions/${encodeURIComponent(id)}`)
      return { status: r.status, session: r.body ? (r.body.session ?? r.body) : null }
    }
    const first = await readSession()
    if (first.session) ctx.evidence.writeJson('app-elevate-session.json', first.session)
    add({ name: 'session_ended', status: first.session?.endedAt ? 'passed' : 'failed', required: true, basis: 'api', area: 'app-data', detail: first.session?.endedAt ? `endedAt ${first.session.endedAt}` : `HTTP ${first.status}; no endedAt` })

    const turns = await pollUntil(async () => {
      const r = await ctx.api.get<{ turns?: Turn[] } | Turn[]>(`/sessions/${encodeURIComponent(id)}/turns`)
      const list = Array.isArray(r.body) ? r.body : r.body?.turns ?? []
      return list.length ? list : null
    }, Math.min(ctx.cfg.verifyTimeoutMs, 60_000), 5000) ?? []
    ctx.evidence.writeJson('app-elevate-turns.json', turns)
    const userTurns = turns.filter(t => /user/i.test(t.role ?? t.speaker ?? '')).map(t => t.text ?? t.content ?? '')
    const userText = userTurns.join(' ')
    add({ name: 'transcript_saved', status: userText.trim() ? 'passed' : 'failed', required: true, basis: 'api', area: 'app-data', detail: `${turns.length} saved turn(s), ${userTurns.length} from the learner; learner text ${userText.trim() ? 'present' : 'missing'}` })
    // Per reply: did each thing the candidate said end up in the saved transcript? (The Northwind failure mode.)
    const spokenTurns = engine.turns.filter(t => t.spoken)
    for (const t of spokenTurns) t.savedRecall = Math.max(0, ...userTurns.map(u => wordRecall(t.spoken!, u)))
    const missing = spokenTurns.filter(t => (t.savedRecall ?? 0) < 0.3)
    add({ name: 'saved_transcript_covers_spoken_replies', status: spokenTurns.length && !missing.length ? 'passed' : 'failed', required: true, basis: 'api', area: 'app-data',
      detail: `${spokenTurns.length - missing.length}/${spokenTurns.length} spoken replies found in ${userTurns.length} saved learner turn(s)` + (missing.length
        ? `; potentially missing: ${missing.map(t => `turn ${t.turn} (${Math.round((t.savedRecall ?? 0) * 100)}% match, ${((t.micTrackVoicedMs ?? 0) / 1000).toFixed(1)} s voiced on the app mic track)`).join(', ')}` : '') })
    const spoken = spokenTurns.map(t => t.spoken!).join(' ')
    const recall = wordRecall(spoken, userText)
    add({ name: 'app_transcript_matches_candidate_speech', status: recall >= 0.6 ? 'passed' : 'failed', required: false, basis: 'api', area: 'app-data', detail: `${Math.round(recall * 100)}% of candidate content words in the app transcript (advisory)` })

    const expectedVoiced = engine.turns.reduce((n, t) => n + (t.micTrackVoicedMs ?? 0), 0)
    for (const c of await verifySavedRecording(ctx, id, spokenTurns.map(t => t.spoken!), expectedVoiced)) add(c)

    const metrics = await pollUntil(async () => {
      const r = await ctx.api.get<Record<string, unknown>>(`/sessions/${encodeURIComponent(id)}/metrics`)
      return r.status === 200 && r.body && Object.keys(r.body).length ? r.body : null
    }, ctx.cfg.verifyTimeoutMs, 5000)
    if (metrics) ctx.evidence.writeJson('app-elevate-metrics.json', metrics)
    add({ name: 'analysis_available', status: metrics ? 'passed' : 'pending', required: true, basis: 'api', area: 'app-data',
      detail: metrics ? 'session metrics returned (existence only; values are not judged)' : 'no metrics within the verification window' })

    const unsettled = (s: SessionView | null) => !s ? ['session unreadable'] : (['paceReconciliationStatus', 'deliveryAlignmentStatus'] as const)
      .filter(k => /pending|processing|running|queued/i.test(String(s[k] ?? ''))).map(k => `${k}=${s[k]}`)
    const settled = await pollUntil(async () => { const s = (await readSession()).session; return unsettled(s).length ? null : s }, ctx.cfg.verifyTimeoutMs, 5000)
    const last = settled ?? (await readSession()).session
    if (last) ctx.evidence.writeJson('app-elevate-session.json', last)
    const failedProcessing = last ? (['paceReconciliationStatus', 'deliveryAlignmentStatus'] as const).filter(k => /fail|error/i.test(String(last[k] ?? ''))).map(k => `${k}=${last[k]}`) : []
    add({ name: 'async_processing_settled', status: failedProcessing.length ? 'failed' : settled ? 'passed' : 'pending', required: true, basis: 'api', area: 'app-data',
      detail: failedProcessing.length ? `processing failed: ${failedProcessing.join(', ')}`
        : settled ? `completed — pace ${settled.paceReconciliationStatus ?? 'n/a'}, delivery alignment ${settled.deliveryAlignmentStatus ?? 'n/a'}`
        : `PENDING (not failed, not completed): still ${unsettled(last).join(', ')} after ${ctx.cfg.verifyTimeoutMs / 1000} s` })

    await ctx.page.getByRole('tab', { name: /Session Analytics/ }).click().catch(() => undefined)
    await ctx.page.waitForTimeout(3000)
    await ctx.screenshot('elevate-analytics')
    await navigateProduct(ctx.page, ctx.cfg, '/elevate')
    const listed = await ctx.page.getByText(this.sessionName).first().waitFor({ timeout: 30_000 }).then(() => true, () => false)
    await ctx.screenshot('elevate-history')
    add({ name: 'history_entry_displayed', status: listed ? 'passed' : 'failed', required: true, basis: 'browser', area: 'app-data', detail: listed ? `Elevate history lists "${this.sessionName}"` : 'session name not found in Elevate history' })
    return checks
  }
}
