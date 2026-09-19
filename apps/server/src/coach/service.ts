import {
  COACH_DEEP_MODEL_ID,
  COACH_FAST_MODEL_ID,
  extractJsonObject,
  invokeCoachModel,
  isCoachLlmEnabled,
  markCoachLlmFailure,
} from './bedrock'
import { buildCoachContext, type CoachContext } from './context'
import { isCoachFocusArea, isCoachModule, type CoachFocusArea, type CoachModule } from './focusAreas'
import {
  buildInterpretPrompt,
  buildRespondPrompt,
  type CoachHistoryTurn,
  type CompletedSessionSummary,
} from './prompt'
import {
  buildPulseEvidence,
  parseEvidenceMode,
  resolvePulseEvidenceMode,
  type PulseEvidence,
} from './pulseEvidence'

export interface CoachBrief {
  focusArea: CoachFocusArea | null
  scenario: string | null
  durationSec: number | null
  preparationId: string | null
  stageId: string | null
}

export interface CoachRecommendation {
  module: CoachModule
  label: string
  reason: string
  brief: CoachBrief
}

export interface CoachClarification {
  question: string
  options: string[]
}

export interface CoachResponse {
  reply: string
  /** Suggested name for an unnamed thread. Always null once the goal is set. */
  goalTitle: string | null
  clarify: CoachClarification | null
  recommend: CoachRecommendation | null
  evidence: PulseEvidence | null
}

const MAX_REPLY = 400
const MAX_REASON = 160
const MAX_SCENARIO = 140
const MAX_LABEL = 40
const MAX_QUESTION = 160
/** Matches the 60-char cap the thread title UI enforces. */
const MAX_GOAL_TITLE = 60
const MIN_DURATION_SEC = 180
const MAX_DURATION_SEC = 900

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed
}

function clampDuration(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  if (rounded < MIN_DURATION_SEC) return MIN_DURATION_SEC
  if (rounded > MAX_DURATION_SEC) return MAX_DURATION_SEC
  return rounded
}

/**
 * Only accepts ids that appear in the context we supplied. A hallucinated
 * preparation or stage id would send the user into a broken launch.
 */
function knownId(value: unknown, allowed: Array<string | null | undefined>): string | null {
  if (typeof value !== 'string') return null
  return allowed.includes(value) ? value : null
}

function parseRecommendation(raw: unknown, ctx: CoachContext): CoachRecommendation | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>

  const module = value.module
  if (!isCoachModule(module)) return null

  const reason = text(value.reason, MAX_REASON)
  if (!reason) return null

  const briefRaw =
    value.brief && typeof value.brief === 'object' && !Array.isArray(value.brief)
      ? (value.brief as Record<string, unknown>)
      : {}

  const preparationId = knownId(briefRaw.preparationId, [ctx.preparation?.id])
  const stageId = knownId(briefRaw.stageId, [ctx.preparation?.nextStage?.id])

  const focusArea = isCoachFocusArea(briefRaw.focusArea) ? briefRaw.focusArea : null

  return {
    module,
    label: usableLabel(text(value.label, MAX_LABEL), module, focusArea),
    reason,
    brief: {
      focusArea,
      scenario: text(briefRaw.scenario, MAX_SCENARIO),
      durationSec: clampDuration(briefRaw.durationSec),
      preparationId,
      // A stage without its preparation is not launchable.
      stageId: preparationId ? stageId : null,
    },
  }
}

function defaultLabel(module: CoachModule, focusArea: CoachFocusArea | null): string {
  switch (module) {
    case 'elevate':
      if (focusArea === 'snapshot') return 'Start Communication Snapshot'
      return focusArea
        ? `Practise ${focusArea.replace(/_/g, ' ')} in Elevate`
        : 'Practise in Elevate'
    case 'replay':
      return 'Analyse recording'
    case 'prepare':
      return 'Open journey'
    case 'progress':
      return 'View progress'
  }
}

/**
 * Elevate sessions run until the user ends them, so a duration in the button is a
 * promise the product does not keep. Snapshot is the one bounded format.
 */
const DURATION_CLAIM = /\b\d+\s*[-\u2013]?\s*(?:min|mins|minute|minutes|sec|second|seconds)\b/i

function usableLabel(
  label: string | null,
  module: CoachModule,
  focusArea: CoachFocusArea | null,
): string {
  if (!label) return defaultLabel(module, focusArea)
  if (focusArea !== 'snapshot' && DURATION_CLAIM.test(label)) {
    return defaultLabel(module, focusArea)
  }
  return label
}

function parseClarification(raw: unknown): CoachClarification | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const question = text(value.question, MAX_QUESTION)
  if (!question) return null
  const options = Array.isArray(value.options)
    ? value.options
        .map((option) => text(option, 40))
        .filter((option): option is string => Boolean(option))
        .slice(0, 4)
    : []
  return { question, options }
}

export function parseCoachResponse(
  raw: string,
  ctx: CoachContext,
  message = '',
): CoachResponse | null {
  const parsed = extractJsonObject(raw)
  if (!parsed) return null

  const reply = text(parsed.reply, MAX_REPLY)
  if (!reply) return null

  const clarify = parseClarification(parsed.clarify)
  // The contract says ask or act, never both. Asking wins: acting on an
  // unanswered question is the failure mode users notice.
  const recommend = clarify ? null : parseRecommendation(parsed.recommend, ctx)
  const mode = resolvePulseEvidenceMode({
    message,
    llmMode: parseEvidenceMode(parsed.evidence),
    hasClarification: Boolean(clarify),
  })
  const evidence = mode
    ? buildPulseEvidence(
        ctx.pulse.skills,
        {
          windowDays: ctx.pulse.windowDays,
          measurementCount: ctx.pulse.measurementCount,
        },
        mode,
        recommend?.brief.focusArea,
      )
    : null

  return { reply, goalTitle: text(parsed.goalTitle, MAX_GOAL_TITLE), clarify, recommend, evidence }
}

export interface GenerateResponseInput {
  userId: string
  firstName: string
  history: CoachHistoryTurn[]
  message: string
  mustRecommend: boolean
  goalTitle: string | null
  preparationId: string | null
}

/**
 * Produces Coach's reply to a user message. Returns null when the LLM is
 * unavailable or returns something unusable, so the caller can fall back to
 * rule-based routing instead of showing an error.
 */
export async function generateCoachResponse(
  input: GenerateResponseInput,
): Promise<{ response: CoachResponse; context: CoachContext } | null> {
  if (!isCoachLlmEnabled()) return null

  const context = await buildCoachContext(input.userId, input.preparationId)
  const prompt = buildRespondPrompt({
    context,
    history: input.history,
    message: input.message,
    firstName: input.firstName,
    mustRecommend: input.mustRecommend,
    goalTitle: input.goalTitle,
  })

  try {
    const raw = await invokeCoachModel(prompt, { modelId: COACH_FAST_MODEL_ID })
    const response = parseCoachResponse(raw, context, input.message)
    if (!response) markCoachLlmFailure()
    return response ? { response, context } : null
  } catch (error) {
    console.error('coach respond', error)
    return null
  }
}

/**
 * Interprets a finished session against the user's goal and history. Uses the
 * stronger model: this runs once per session and is the payoff for the loop.
 */
export async function interpretCoachResult(input: {
  userId: string
  goalTitle: string | null
  preparationId: string | null
  session: CompletedSessionSummary
}): Promise<CoachResponse | null> {
  if (!isCoachLlmEnabled()) return null

  const context = await buildCoachContext(input.userId, input.preparationId)
  const prompt = buildInterpretPrompt({
    context,
    goalTitle: input.goalTitle,
    session: input.session,
  })

  try {
    const raw = await invokeCoachModel(prompt, {
      modelId: COACH_DEEP_MODEL_ID,
      maxTokens: 900,
      timeoutMs: 20_000,
    })
    const response = parseCoachResponse(raw, context)
    if (!response) markCoachLlmFailure()
    return response
  } catch (error) {
    console.error('coach interpret', error)
    return null
  }
}
