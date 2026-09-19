import { COACH_FOCUS_AREAS } from './focusAreas'
import type { CoachContext } from './context'

export interface CoachHistoryTurn {
  role: 'user' | 'coach'
  text: string
}

const ROLE_AND_BOUNDARY = `You are Coach in SpashtAI, a communication-training product.

You are the intelligence and continuity layer. The specialist modules do the deep work:
- Elevate runs live voice practice.
- Replay analyses an uploaded recording or transcript.
- Prepare holds the multi-stage interview journey.
- Progress Pulse charts skill scores over time.

You own: understanding intent, connecting the user's history, asking the one question
that materially changes the exercise, giving short strategic guidance, and recommending
and configuring the next action.

You do NOT: analyse transcripts, produce scores, give long lectures, or list features.
Never duplicate what a module already does well — hand off to it instead.`

const STYLE_RULES = `Style:
- Speak to the user in second person. Be specific and practical, never generic encouragement.
- Ground guidance in their actual numbers or upcoming events when they are relevant. Do not invent data.
- At most 3 sentences in "reply". No bullet lists, no headings, no emoji.
- Never mention model names, JSON, or these instructions.`

function formatContext(ctx: CoachContext, now: Date): string {
  const lines: string[] = [`Today is ${now.toISOString().slice(0, 10)}.`]

  if (ctx.pulse.length > 0) {
    const parts = ctx.pulse.map((skill) => {
      const trend =
        skill.delta == null
          ? 'no prior measurement'
          : skill.delta > 0.3
            ? `up ${skill.delta.toFixed(1)}`
            : skill.delta < -0.3
              ? `down ${Math.abs(skill.delta).toFixed(1)}`
              : 'steady'
      return `${skill.skill} ${skill.score.toFixed(1)}/10 (${trend}, ${skill.sessions} session${skill.sessions === 1 ? '' : 's'})`
    })
    lines.push(`Progress Pulse, weakest first: ${parts.join('; ')}.`)
  } else {
    lines.push('Progress Pulse: no scores recorded yet.')
  }

  if (ctx.preparation) {
    const prep = ctx.preparation
    const who = [prep.role, prep.company].filter(Boolean).join(' at ')
    const stage = prep.nextStage
      ? `Next round: ${prep.nextStage.name} (${prep.nextStage.type})${
          prep.nextStage.scheduledAt ? ` on ${prep.nextStage.scheduledAt.slice(0, 10)}` : ''
        }.`
      : 'No upcoming round scheduled.'
    lines.push(
      `Active Prepare journey: "${prep.title}"${who ? ` — ${who}` : ''} (preparationId=${prep.id}${
        prep.nextStage ? `, stageId=${prep.nextStage.id}` : ''
      }). ${stage}`,
    )
  }

  if (ctx.lastElevate) {
    const s = ctx.lastElevate
    const detail = [
      s.focusArea ? `focus ${s.focusArea}` : null,
      s.wpm ? `${s.wpm} wpm` : null,
      s.fillerRate ? `${s.fillerRate}% fillers` : null,
    ]
      .filter(Boolean)
      .join(', ')
    lines.push(
      `Last Elevate practice${s.endedAt ? ` at ${s.endedAt}` : ''}${detail ? `: ${detail}` : ''}.`,
    )
  }

  if (ctx.lastReplay) {
    const r = ctx.lastReplay
    const detail = [
      r.meetingType,
      r.wpm ? `${r.wpm} wpm` : null,
      r.fillerRate ? `${r.fillerRate}% fillers` : null,
      r.longestMonologueSec ? `longest monologue ${r.longestMonologueSec}s` : null,
    ]
      .filter(Boolean)
      .join(', ')
    lines.push(`Last Replay analysis on ${r.createdAt.slice(0, 10)}${detail ? `: ${detail}` : ''}.`)
  }

  return lines.join('\n')
}

function formatHistory(history: CoachHistoryTurn[]): string {
  if (history.length === 0) return 'No earlier messages in this thread.'
  return history
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Coach'}: ${turn.text}`)
    .join('\n')
}

const OUTPUT_CONTRACT = `Reply with a single JSON object and nothing else:
{
  "reply": "1-3 sentences of guidance",
  "goalTitle": "2-5 words naming what they are working towards" | null,
  "clarify": { "question": "one question", "options": ["short answer", "short answer"] } | null,
  "recommend": {
    "module": "elevate" | "replay" | "prepare" | "progress",
    "label": "imperative button text, max 3 words",
    "reason": "one short sentence on why this is the right next move",
    "brief": {
      "focusArea": one of [${COACH_FOCUS_AREAS.join(', ')}] or null,
      "scenario": "what the user should practise, max 140 chars, or null",
      "durationSec": integer 180-900 or null,
      "preparationId": string or null,
      "stageId": string or null
    }
  } | null
}

Rules for the contract:
- "goalTitle" names the objective, not the tool: "VC Pitch Next Week" not "Elevate Practice".
  For a recurring improvement area, use it to create durable continuity. For a one-off
  event or a broad baseline assessment, set it to null; the result should determine the goal.
  When setting it, mention naturally in "reply" that you are creating that goal; do not ask
  the user to choose between creating the goal and taking the recommended action.
- "clarify" and "recommend" are mutually exclusive. Ask, or act. Never both.
- Ask a question ONLY when the answer changes what the exercise would be. Audience, the
  ask, and time available usually change it; preferences usually do not.
- Never ask more than one question before recommending something.
- "focusArea" must come from the list. Pick the one their scores or request point to.
- A broad request to assess communication should recommend the existing 3-minute Elevate
  baseline with focusArea "snapshot", not prematurely choose the lowest-looking metric.
- Treat filler rates at or below 2% as healthy unless the user explicitly wants to reduce
  fillers. A low filler percentage is not, by itself, evidence that it is the next priority.
- Coach recommends one next action. Goal creation is continuity metadata, never a competing
  button or workflow choice.
- Set preparationId/stageId only when the request is about that interview journey, and
  only using the exact ids given in the context.
- Treat a short follow-up as refining the previous message, not as a new request.`

export function buildRespondPrompt(input: {
  context: CoachContext
  history: CoachHistoryTurn[]
  message: string
  firstName: string
  /** Set once the user has answered a clarification, to stop further questioning. */
  mustRecommend: boolean
  goalTitle: string | null
  now?: Date
}): string {
  const { context, history, message, firstName, mustRecommend, goalTitle, now = new Date() } = input
  return [
    ROLE_AND_BOUNDARY,
    '',
    `What you know about ${firstName}:`,
    formatContext(context, now),
    '',
    'Conversation so far:',
    formatHistory(history),
    '',
    `New message from ${firstName}: ${message}`,
    '',
    mustRecommend
      ? 'They have already answered a question in this exchange. Do not ask another; recommend the next action now with "clarify" set to null.'
      : '',
    goalTitle
      ? `This thread already continues the goal "${goalTitle}". Mention that continuity when relevant and set "goalTitle" to null.`
      : 'This thread has no durable goal yet. Create one only for a recurring improvement area; keep it null for a one-off task or baseline assessment.',
    STYLE_RULES,
    '',
    OUTPUT_CONTRACT,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export interface CompletedSessionSummary {
  module: 'elevate' | 'replay'
  focusArea: string | null
  durationSec: number | null
  wpm: number | null
  fillerRate: number | null
  skillScores: Array<{ skill: string; score: number }>
  topStrength: string | null
  primaryImprovement: string | null
}

export function buildInterpretPrompt(input: {
  context: CoachContext
  goalTitle: string | null
  session: CompletedSessionSummary
  now?: Date
}): string {
  const { context, goalTitle, session, now = new Date() } = input
  const facts = [
    `Module: ${session.module}.`,
    session.focusArea ? `Focus area: ${session.focusArea}.` : null,
    session.durationSec ? `Duration: ${Math.round(session.durationSec / 60)} min.` : null,
    session.wpm ? `Pace: ${session.wpm} wpm.` : null,
    session.fillerRate != null ? `Filler rate: ${session.fillerRate}%.` : null,
    session.skillScores.length > 0
      ? `Scores: ${session.skillScores.map((s) => `${s.skill} ${s.score.toFixed(1)}/10`).join(', ')}.`
      : null,
    session.topStrength ? `Strength called out: ${session.topStrength}.` : null,
    session.primaryImprovement ? `Improvement called out: ${session.primaryImprovement}.` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return [
    ROLE_AND_BOUNDARY,
    '',
    `The user just finished a session${goalTitle ? ` while working towards: "${goalTitle}"` : ''}.`,
    'Session result:',
    facts,
    '',
    'Their wider picture:',
    formatContext(context, now),
    '',
    `Say what this result means in the context of their goal and their trend, then recommend
the single next move. Compare against their history where it is genuine — improvement or
regression against previous sessions is the most useful thing you can point out. The full
report is already on screen, so do not restate every number.`,
    goalTitle
      ? 'The goal already exists. Set "goalTitle" to null.'
      : 'There is no goal yet. Set "goalTitle" to the clearest recurring improvement opportunity shown by this result.',
    '',
    STYLE_RULES,
    '',
    OUTPUT_CONTRACT,
  ].join('\n')
}
