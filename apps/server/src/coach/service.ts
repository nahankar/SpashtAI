import {
  COACH_DEEP_MODEL_ID,
  COACH_FAST_MODEL_ID,
  extractJsonObject,
  invokeCoachModel,
  isCoachLlmEnabled,
  markCoachLlmFailure,
} from './bedrock'
import { buildCoachContext, type CoachContext } from './context'
import {
  coachFocusLabel,
  detectModuleSignal,
  explicitCoachFocuses,
  isAffirmedFocusIntent,
  isCoachFocusArea,
  isCoachModule,
  isExplanationRequest,
  isExploratoryMessage,
  isUncertainMessage,
  type CoachFocusArea,
  type CoachModule,
} from './focusAreas'
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

  // Snapshot is an Elevate format. Offering it inside Progress Pulse sends the
  // user to a dashboard that cannot run the three questions.
  if (focusArea === 'snapshot' && module !== 'elevate') {
    return {
      module: 'elevate',
      label: defaultLabel('elevate', 'snapshot'),
      reason,
      brief: {
        focusArea,
        scenario: text(briefRaw.scenario, MAX_SCENARIO),
        durationSec: clampDuration(briefRaw.durationSec),
        preparationId: null,
        stageId: null,
      },
    }
  }

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
  policy: { answeringClarification?: boolean } = {},
): CoachResponse | null {
  const parsed = extractJsonObject(raw)
  if (!parsed) return null

  let reply = text(parsed.reply, MAX_REPLY)
  if (!reply) return null

  let clarify = parseClarification(parsed.clarify)
  // The contract says ask or act, never both. Asking wins: acting on an
  // unanswered question is the failure mode users notice.
  let recommend = clarify ? null : parseRecommendation(parsed.recommend, ctx)
  let goalTitle = text(parsed.goalTitle, MAX_GOAL_TITLE)
  const focuses = explicitCoachFocuses(message)

  if (isExplanationRequest(message)) {
    // A why-question is about the recommendation already on screen. Rendering
    // the same action again makes Coach look as though it ignored the question.
    if (focuses.length > 1) {
      const labels = focuses.map(coachFocusLabel)
      reply = `${labels[0][0].toUpperCase() + labels[0].slice(1)} and ${labels[1]} are separate skills. One should not be substituted for the other without evidence.`
    }
    clarify = null
    recommend = null
    goalTitle = null
  } else if (focuses.length > 1) {
    const labels = focuses.map(coachFocusLabel)
    reply = `${labels.map((label) => label[0].toUpperCase() + label.slice(1)).join(' and ')} are separate practice focuses. Choose the one that matters most right now.`
    clarify = {
      question: 'Which would you like to focus on first?',
      options: labels.map((label) => label[0].toUpperCase() + label.slice(1)),
    }
    recommend = null
    goalTitle = null
  } else if (isExploratoryMessage(message)) {
    // Mentioning a skill while asking about available options is exploration,
    // not permission to create a goal or launch a workspace.
    reply =
      'You can work on clarity, confidence, filler words, pacing, conciseness, structure, or engagement. Tell me which outcome matters most and I’ll recommend the right practice.'
    recommend = null
    goalTitle = null
  } else if (focuses.length === 1 && !clarify) {
    const focus = focuses[0]
    const label = coachFocusLabel(focus)
    const moduleSignal = detectModuleSignal(message)

    if (!moduleSignal) {
      // The user named a skill and nothing in the message points at another
      // workspace, so practising it in Elevate is the only matching action.
      // This must not be scoped to recommendations that already chose Elevate:
      // the model otherwise escapes the check by picking a different module.
      if (recommend?.module !== 'elevate' || recommend.brief.focusArea !== focus) {
        const subject =
          focus === 'filler_words' || focus === 'action_items'
            ? `${label[0].toUpperCase() + label.slice(1)} are`
            : `${label[0].toUpperCase() + label.slice(1)} is`
        reply = `${subject} the focus you named. Elevate will practise that skill directly rather than substitute a related one.`
        recommend = {
          module: 'elevate',
          label: defaultLabel('elevate', focus),
          reason: `This practice directly targets ${label}.`,
          brief: {
            focusArea: focus,
            scenario: recommend?.brief.scenario ?? null,
            durationSec: null,
            preparationId: null,
            stageId: null,
          },
        }
      } else {
        recommend = { ...recommend, label: defaultLabel('elevate', focus) }
      }
    } else if (recommend && recommend.brief.focusArea !== focus) {
      // The message asked for a specific workspace. Keep it, but carry the
      // skill they named into the brief.
      recommend = { ...recommend, brief: { ...recommend.brief, focusArea: focus } }
    }
  }

  if (!isAffirmedFocusIntent(message, policy.answeringClarification === true)) {
    goalTitle = null
  }

  const mode =
    isExplanationRequest(message) || isExploratoryMessage(message)
      ? null
      : resolvePulseEvidenceMode({
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

  return { reply, goalTitle, clarify, recommend, evidence }
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

export function initialUncertainResponse(
  input: Pick<GenerateResponseInput, 'history' | 'message' | 'goalTitle'>,
): CoachResponse | null {
  if (input.history.length > 0 || input.goalTitle || !isUncertainMessage(input.message)) {
    return null
  }
  return {
    reply:
      'No problem. Start with a Communication Snapshot: answer three short questions and I’ll identify the most useful area to practise.',
    goalTitle: null,
    clarify: null,
    recommend: {
      module: 'elevate',
      label: 'Start Communication Snapshot',
      reason: '3 questions · about 3 minutes',
      brief: {
        focusArea: 'snapshot',
        scenario: 'Establish a broad communication baseline.',
        durationSec: 180,
        preparationId: null,
        stageId: null,
      },
    },
    evidence: null,
  }
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
  const uncertainResponse = initialUncertainResponse(input)
  if (uncertainResponse) return { context, response: uncertainResponse }
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
    const response = parseCoachResponse(raw, context, input.message, {
      answeringClarification: input.mustRecommend,
    })
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
