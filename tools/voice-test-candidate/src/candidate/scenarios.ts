import type { Experience } from '../config.js'

export interface Scenario {
  id: string
  experience: Experience
  description: string
  defaultProfile: string
  /** Style instructions for the response generator. */
  style: string
  answerWords: [number, number]
  /** Delay from the end of SpashtAI's speech to the candidate's first sample, sampled per turn. */
  thinkDelayMs: [number, number]
  /**
   * Hesitation: the generator marks pauses with "..." and the synthesizer inserts real silence of this length
   * between the spoken pieces. Kept below SpashtAI's ~5 s automatic-finish silence so pauses stay inside an answer.
   */
  pauseMs?: [number, number]
  /** Controlled silence: on these 1-based candidate turns, stay silent for `silenceMs` before answering. */
  silentTurns?: number[]
  silenceMs?: number
  /**
   * Interview interaction mode the scenario certifies. `automatic`: the interviewer finishes answers and moves
   * on (conversation access). `manual`: the learner uses Finish answer / Skip question / Next question.
   * The account's access decides the mode the app actually uses; the run is blocked if it differs.
   */
  interviewMode?: 'automatic' | 'manual'
  /** Manual scenarios: what the learner does after each spoken reply, in order. */
  manualPlan?: ManualStep[]
  /** Default practice time for this scenario (minutes). */
  practiceMinutes?: number
}

/** finish-next: speak, Finish answer, Next question · skip-next: say you will skip, Skip question, Next question ·
 *  finish-end: speak, Finish answer, then End practice. */
export type ManualStep = 'finish-next' | 'skip-next' | 'finish-end'

export const SKIP_REPLY = "I'm not confident about this one, so I'd like to skip it and move on."


export const SCENARIOS: Record<string, Scenario> = {
  'confident-interview': {
    id: 'confident-interview', experience: 'interview', defaultProfile: 'qa-engineer',
    description: 'A prepared, confident candidate answering each question directly with a concrete example.',
    style: 'Answer confidently and directly. Lead with the answer, then give one concrete example from your background. Use natural spoken English, no lists or markdown.',
    answerWords: [40, 75], thinkDelayMs: [700, 1600], interviewMode: 'automatic',
  },
  'manual-interview': {
    id: 'manual-interview', experience: 'interview', defaultProfile: 'qa-engineer',
    description: 'Manual Interview controls: answer Q1 then Finish + Next, ask to skip Q2 then Skip + Next, answer Q3 then Finish + End practice.',
    style: 'Answer clearly and directly with one concrete example from your background. Natural spoken English, no lists or markdown.',
    answerWords: [35, 60], thinkDelayMs: [700, 1500], interviewMode: 'manual', manualPlan: ['finish-next', 'skip-next', 'finish-end'], practiceMinutes: 15,
  },
  'hesitant-interview': {
    id: 'hesitant-interview', experience: 'interview', defaultProfile: 'qa-engineer',
    description: 'A nervous candidate who uses fillers ("um", "uh", "you know") and pauses mid-answer, but still answers.',
    style: 'You are nervous. Use fillers such as "um", "uh", "you know" and "I mean" a few times, restart one sentence, and mark two or three thinking pauses with "..." (three dots) where you stop to think. Still give a relevant, mostly correct answer.',
    answerWords: [45, 80], thinkDelayMs: [1500, 3000], pauseMs: [900, 1800], interviewMode: 'automatic',
  },
  'silence-interview': {
    id: 'silence-interview', experience: 'interview', defaultProfile: 'qa-engineer',
    description: 'Controlled silence: stays silent after the first question for a fixed time, then answers normally.',
    style: 'Answer clearly and directly with one example. Use natural spoken English.',
    answerWords: [45, 80], thinkDelayMs: [700, 1500], silentTurns: [1], silenceMs: 20_000, interviewMode: 'automatic',
  },
  'elevate-learner': {
    id: 'elevate-learner', experience: 'elevate', defaultProfile: 'learner-pm',
    description: 'A cooperative learner who follows the Elevate coach\'s exercise instructions turn by turn.',
    style: 'You are a learner in a speaking-practice session with a communication coach. Follow the coach\'s instructions exactly: if asked to explain a topic, explain it; if asked to retry with an analogy, do so; if asked a question about yourself, answer it. Keep each reply within the time the coach asks for. Natural spoken English, no lists or markdown.',
    answerWords: [40, 90], thinkDelayMs: [800, 1800],
  },
}

export function getScenario(id: string): Scenario {
  const scenario = SCENARIOS[id]
  if (!scenario) throw new Error(`Unknown scenario "${id}". Available: ${Object.keys(SCENARIOS).join(', ')}`)
  return scenario
}

/** Small deterministic PRNG so delays and pauses are reproducible for a given --seed. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000 }
}

export function between(rand: () => number, [lo, hi]: [number, number]): number {
  return Math.round(lo + (hi - lo) * rand())
}
