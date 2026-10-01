/**
 * Session-level chat — grounded Q&A about a single session (Elevate / Replay).
 *
 * The "Ask AI Coach about this session" box. Controlled by the `session_chat`
 * feature flag (disabled by default; an admin turns it on). Reuses the Coach's
 * Bedrock wrapper (`invokeCoachModel` — timeout + circuit breaker) so there is no
 * new LLM integration path. Stateless: the client sends the short chat history
 * back each turn, so there is no new table/migration.
 *
 * Safety: every request is ownership-checked (the session/replay must belong to
 * the caller) and the model is instructed to answer only from the provided data.
 */
import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { prisma } from '../lib/prisma'
import { isFeatureAccessible } from '../lib/featureFlags'
import { getElevateSessionOwnerId, getReplaySessionOwnerId, isPrivilegedRole } from '../lib/userExportFlags'
import { invokeCoachModel, COACH_FAST_MODEL_ID, isCoachLlmEnabled } from '../coach/bedrock'
import { inspectDeliveryMoments } from '../analytics/deliveryMoments'
import { reqLog } from '../lib/logger'

const router = Router()

type Module = 'elevate' | 'replay'
const SUPPORTED_MODULES: Module[] = ['elevate', 'replay']

// Each POST is a Bedrock call — cap it per user (well under the global apiLimiter)
// so the box can't be turned into a cost/abuse vector.
const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  // Route is always behind requireAuth, so userId is present. Keying on userId
  // (not req.ip) also sidesteps express-rate-limit v8's IPv6 keyGenerator check.
  keyGenerator: (req) => (req as { user?: { userId?: string } }).user?.userId || 'anon',
  message: { error: 'Too many questions — please slow down and try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Model for session chat. Defaults to the Coach's fast model, but overridable so
// ops can point per-message chat at a cheaper model (e.g. Nova Lite) without
// touching the Coach.
const SESSION_CHAT_MODEL_ID = process.env.BEDROCK_SESSION_CHAT_MODEL_ID || COACH_FAST_MODEL_ID

const MAX_HISTORY = 12 // chat turns kept for context
const MAX_QUESTION_CHARS = 1000
const MAX_CONTEXT_CHARS = 12_000
const MAX_TURNS_IN_CONTEXT = 40
const MAX_REPLY_TOKENS = 600

/** seconds → m:ss */
function clock(sec: unknown): string {
  const n = typeof sec === 'number' && isFinite(sec) ? Math.max(0, Math.round(sec)) : null
  if (n === null) return '—'
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
}

function num(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null
}

/** Compact, human-readable block of known fields + a bounded JSON tail. */
function summariseJson(value: unknown, keys: string[], cap = 800): string {
  if (!value || typeof value !== 'object') return ''
  const obj = value as Record<string, unknown>
  const picked = keys
    .filter((k) => obj[k] !== undefined && obj[k] !== null && typeof obj[k] !== 'object')
    .map((k) => `${k}=${obj[k]}`)
  if (picked.length > 0) return picked.join(' ')
  try {
    const s = JSON.stringify(obj)
    return s.length > cap ? s.slice(0, cap) + '…' : s
  } catch {
    return ''
  }
}

function clamp10(n: number): number {
  return Math.max(0, Math.min(10, n))
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Fluency (0-10), matching the Trends chart: 10 − per-turn filler rate (a percentage). */
function fluencyFromFillerRate(fillerRate: number | null): number | null {
  return fillerRate === null ? null : round1(clamp10(10 - fillerRate))
}

/** Per-turn confidence (0-10) from the LLM-judge score, matching the Trends chart. */
function turnConfidence(score: unknown): number | null {
  if (!score || typeof score !== 'object') return null
  const s = score as Record<string, unknown>
  const conf = num(s.confidence)
  if (conf !== null) return round1(clamp10(conf > 1 ? conf / 10 : conf * 10))
  const stars = num(s.stars)
  if (stars !== null) return round1(clamp10((stars / 5) * 10))
  return null
}

async function buildElevateContext(sessionId: string): Promise<string | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      metrics: true,
      turns: { orderBy: { turnIndex: 'asc' } },
    },
  })
  if (!session) return null

  const allUserTurns = session.turns.filter((t) => t.role === 'user')
  const userTurns = allUserTurns.slice(0, MAX_TURNS_IN_CONTEXT)
  const turnMet = (t: (typeof session.turns)[number]) =>
    (t.metrics && typeof t.metrics === 'object' ? t.metrics : {}) as Record<string, unknown>

  const lines: string[] = []
  lines.push(`SESSION (module=elevate)`)
  lines.push(`Focus: ${session.focusArea ?? 'general'}  Duration: ${clock(session.durationSec)}`)

  const m = session.metrics
  if (m) {
    const wpm = num(m.userWpm)
    const filler = num(m.userFillerRate)
    lines.push(
      `Overall (whole session): avg WPM ${wpm ?? '—'}, filler rate ${filler !== null ? (filler * 100).toFixed(1) + '%' : '—'}`,
    )
    const scores = summariseJson(m.skillScores, ['clarity', 'confidence', 'engagement', 'structure', 'conciseness', 'pacing'])
    if (scores) lines.push(`Skill scores (0-10, whole session): ${scores}`)
    const insights = summariseJson(m.coachingInsights, ['topStrength', 'primaryImprovement', 'actionableAdvice'], 1200)
    if (insights) lines.push(`Coaching insights: ${insights}`)
  }

  // Fluency is not a stored skill — it is derived per turn as (10 − filler rate),
  // exactly like the "Fluency" line in Trends. Surface a session average so
  // questions like "what is my fluency" can be answered.
  const fluencies = allUserTurns
    .map((t) => fluencyFromFillerRate(num(turnMet(t).filler_rate)))
    .filter((v): v is number => v !== null)
  if (fluencies.length > 0) {
    const avg = fluencies.reduce((a, b) => a + b, 0) / fluencies.length
    lines.push(`Fluency (avg 0-10, whole session; derived as 10 − filler rate per turn): ${round1(avg)}`)
  }

  // Pauses / delivery moments — same source (and same feature gate) as the
  // "Delivery moments" cards on the page; empty when that capability is off.
  // Placed before the per-turn transcript so these few high-value lines survive
  // if the context is truncated to MAX_CONTEXT_CHARS.
  try {
    const delivery = await inspectDeliveryMoments(sessionId)
    const moments = delivery.moments ?? []
    if (moments.length > 0) {
      lines.push(`Pauses (${moments.length}):`)
      for (const mo of moments.slice(0, 20)) {
        const kind = mo.kind === 'mid_thought_pause' ? 'mid-sentence' : 'after a sentence'
        const observation = typeof mo.observation === 'string' ? mo.observation.slice(0, 120) : ''
        lines.push(
          `  @${clock(mo.startSec)} ${mo.pauseSeconds.toFixed(1)}s ${kind} (${mo.polarity})` +
            (observation ? ` — ${observation}` : ''),
        )
      }
    }
  } catch {
    // Delivery inspection is best-effort; never block the answer on it.
  }

  if (userTurns.length > 0) {
    lines.push(`Your turns${allUserTurns.length > userTurns.length ? ` (first ${userTurns.length} of ${allUserTurns.length})` : ` (${userTurns.length})`}:`)
    for (const t of userTurns) {
      const met = turnMet(t)
      const wpm = num(met.wpm)
      const fillers = num(met.filler_count)
      const fluency = fluencyFromFillerRate(num(met.filler_rate))
      const confidence = turnConfidence(t.score)
      const text = typeof t.text === 'string' ? t.text.replace(/\s+/g, ' ').slice(0, 220) : ''
      lines.push(
        `  #${t.turnIndex} @${clock(t.audioStart)}` +
          (wpm !== null ? ` wpm=${Math.round(wpm)}` : '') +
          (fillers !== null ? ` fillers=${fillers}` : '') +
          (fluency !== null ? ` fluency=${fluency}` : '') +
          (confidence !== null ? ` confidence=${confidence}` : '') +
          (text ? ` — "${text}"` : ''),
      )
    }
  }

  return lines.join('\n')
}

async function buildReplayContext(sessionId: string): Promise<string | null> {
  const rs = await prisma.replaySession.findUnique({
    where: { id: sessionId },
    include: { result: true },
  })
  if (!rs) return null

  const lines: string[] = []
  lines.push(`SESSION (module=replay)`)
  lines.push(`Meeting: ${rs.meetingType ?? '—'}  Your role: ${rs.userRole ?? '—'}  Focus: ${(rs.focusAreas ?? []).join(', ') || '—'}`)
  const r = rs.result
  if (r) {
    lines.push(`Scores (0-10): overall=${num(r.overallScore) ?? '—'} clarity=${num(r.clarityScore) ?? '—'}`)
    const scores = summariseJson(r.skillScores, ['clarity', 'confidence', 'engagement', 'structure', 'conciseness', 'pacing'])
    if (scores) lines.push(`Skill scores: ${scores}`)
    const insights = summariseJson(r.coachingInsights, ['topStrength', 'primaryImprovement', 'actionableAdvice'], 1200)
    if (insights) lines.push(`Coaching insights: ${insights}`)
    if (typeof r.transcriptText === 'string' && r.transcriptText.trim()) {
      const tx = r.transcriptText.replace(/\s+/g, ' ').slice(0, 6000)
      lines.push(`Transcript (excerpt):\n${tx}`)
    }
  } else {
    lines.push('(Analysis not complete for this session.)')
  }
  return lines.join('\n')
}

function buildPrompt(context: string, history: Array<{ role: string; content: string }>, question: string): string {
  const convo = history
    .slice(-MAX_HISTORY)
    .map((m) => `${m.role === 'assistant' ? 'Coach' : 'User'}: ${m.content}`)
    .join('\n')
  return [
    'You are SpashtAI, a warm, concise communication coach answering questions about ONE practice session.',
    'Ground every answer strictly in the SESSION data below.',
    'Session-level values (skill scores, averages like fluency, overall stats) describe the WHOLE session — never attach a timestamp to them. Only cite a timestamp (m:ss) for a specific per-turn moment or a pause.',
    'If the data does not contain the answer, say so plainly — never invent numbers, pauses, or quotes.',
    'Keep replies short and practical (a few sentences).',
    '',
    '--- SESSION DATA (trusted) ---',
    context.slice(0, MAX_CONTEXT_CHARS),
    '--- END SESSION DATA ---',
    '',
    convo ? `Conversation so far:\n${convo}\n` : '',
    `User: ${question}`,
    'Coach:',
  ].join('\n')
}

/** GET /api/session-chat/availability → { enabled } (drives the box's active/Pro state). */
router.get('/availability', async (_req: Request, res: Response) => {
  try {
    res.json({ enabled: await isFeatureAccessible('session_chat') })
  } catch {
    res.json({ enabled: false })
  }
})

/** POST /api/session-chat → { reply } */
router.post('/', chatLimiter, async (req: Request, res: Response) => {
  try {
    if (!(await isFeatureAccessible('session_chat'))) {
      res.status(403).json({ error: 'Session chat is not enabled', code: 'FEATURE_DISABLED' })
      return
    }

    const body = (req.body ?? {}) as {
      module?: string
      sessionId?: string
      messages?: Array<{ role?: string; content?: string }>
    }
    const mod = body.module as Module
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (!SUPPORTED_MODULES.includes(mod) || !sessionId) {
      res.status(400).json({ error: 'module (elevate|replay) and sessionId are required' })
      return
    }

    const history = Array.isArray(body.messages)
      ? body.messages
          .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
          .map((m) => ({ role: m.role as string, content: (m.content as string).slice(0, MAX_QUESTION_CHARS) }))
      : []
    const last = history[history.length - 1]
    if (!last || last.role !== 'user' || !last.content.trim()) {
      res.status(400).json({ error: 'The last message must be a non-empty user question' })
      return
    }
    const question = last.content.trim()
    const priorHistory = history.slice(0, -1)

    // Ownership check — the session/replay must belong to the caller.
    const ownerId = mod === 'elevate'
      ? await getElevateSessionOwnerId(sessionId)
      : await getReplaySessionOwnerId(sessionId)
    if (!ownerId) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    if (ownerId !== req.user!.userId && !isPrivilegedRole(req.user!.role)) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const context = mod === 'elevate'
      ? await buildElevateContext(sessionId)
      : await buildReplayContext(sessionId)
    if (!context) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    if (!isCoachLlmEnabled()) {
      res.status(503).json({ error: 'Coach is temporarily unavailable. Please try again shortly.' })
      return
    }

    const prompt = buildPrompt(context, priorHistory, question)
    let reply: string
    try {
      reply = (await invokeCoachModel(prompt, { modelId: SESSION_CHAT_MODEL_ID, maxTokens: MAX_REPLY_TOKENS, temperature: 0.3 })).trim()
    } catch (err) {
      reqLog(req).warn({ err, event: 'session_chat.llm_failed', module: mod, sessionId }, 'session chat LLM failed')
      res.status(503).json({ error: 'Coach is temporarily unavailable. Please try again shortly.' })
      return
    }
    if (!reply) {
      res.status(503).json({ error: 'Coach could not answer that. Please rephrase or try again.' })
      return
    }

    reqLog(req).info({ event: 'session_chat.answered', module: mod, sessionId }, 'session chat answered')
    res.json({ reply })
  } catch (err) {
    reqLog(req).error({ err, event: 'session_chat.error' }, 'session chat error')
    res.status(500).json({ error: 'Failed to answer question' })
  }
})

export default router
