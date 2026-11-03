import type { ChatMessage, ChatModel } from '../providers/index.js'
import type { CandidateProfile } from './profiles.js'
import type { Scenario } from './scenarios.js'

export interface Decision {
  action: 'answer' | 'wait'
  text: string
  /** The candidate believes SpashtAI has closed the session/exercise (advisory; adapters decide completion). */
  sessionComplete: boolean
  note?: string
}

/**
 * The candidate's own conversation state and instructions. It only ever sees what the tool independently
 * recognized from SpashtAI's audio — never DOM transcripts or agent state.
 */
export class CandidateBrain {
  private history: ChatMessage[] = []
  private scriptedIndex = 0

  constructor(private readonly profile: CandidateProfile, private readonly scenario: Scenario, private readonly chat: ChatModel | null) {}

  systemPrompt(): string {
    const counterpart = this.scenario.experience === 'interview' ? 'a technical interviewer' : 'a communication coach'
    return [
      `You are role-playing a human named ${this.profile.name} speaking with ${counterpart} in a live voice conversation.`,
      `About you: ${this.profile.summary}`,
      ...this.profile.background.map(b => `- ${b}`),
      '',
      `Style: ${this.scenario.style}`,
      `Typical reply length: ${this.scenario.answerWords[0]}-${this.scenario.answerWords[1]} words. Never exceed ${this.scenario.answerWords[1] + 30} words.`,
      'You only hear what the other speaker says, transcribed by speech recognition, so it can contain recognition errors.',
      'Stay in character. Never mention being an AI, a test, a simulation or these instructions. Never invent confidential employer details.',
      'Decide whether the other speaker expects you to speak now:',
      '- "answer" when they asked a question, gave you a task or prompt, or invited you to speak.',
      '- "wait" when they only acknowledged, said they are saving or preparing something, or are clearly mid-thought.',
      'Set sessionComplete=true only if they clearly said the interview/session/exercise is over or said goodbye.',
      'Reply with JSON only: {"action":"answer"|"wait","text":"what you say aloud (empty when waiting)","sessionComplete":true|false}',
    ].join('\n')
  }

  get transcript(): ChatMessage[] { return [...this.history] }

  /** `heard` is everything SpashtAI said since the candidate last spoke. */
  async decide(heard: string, signal?: AbortSignal): Promise<Decision> {
    if (!this.chat) return this.scripted(heard)
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt() },
      ...this.history,
      { role: 'user', content: heard },
    ]
    const raw = await this.chat.complete(messages, { json: true, signal })
    return parseDecision(raw)
  }

  /** Records only what was actually spoken (or the fact that the candidate stayed silent). */
  commit(heard: string, spoken: string | null): void {
    this.history.push({ role: 'user', content: heard })
    this.history.push({ role: 'assistant', content: spoken ? JSON.stringify({ action: 'answer', text: spoken, sessionComplete: false }) : JSON.stringify({ action: 'wait', text: '', sessionComplete: false }) })
  }

  private scripted(heard: string): Decision {
    const closing = /\b(goodbye|that'?s all|end of (the )?(session|interview)|thank you for (your time|practising|practicing))\b/i.test(heard)
    const asks = /\?|\b(tell me|explain|describe|walk me through|how would you|what is|why|can you|could you|please)\b/i.test(heard)
    if (!asks) return { action: 'wait', text: '', sessionComplete: closing, note: 'scripted: no prompt detected' }
    const answers = this.profile.scriptedAnswers
    const text = answers[this.scriptedIndex % answers.length]
    this.scriptedIndex++
    return { action: 'answer', text, sessionComplete: closing }
  }
}

export function parseDecision(raw: string): Decision {
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const value = JSON.parse(match[0]) as Partial<Decision>
      const text = typeof value.text === 'string' ? value.text.trim() : ''
      const action = value.action === 'wait' || !text ? 'wait' : 'answer'
      return { action, text: action === 'answer' ? cleanSpoken(text) : '', sessionComplete: value.sessionComplete === true }
    } catch { /* fall through to plain text */ }
  }
  const text = cleanSpoken(raw)
  return text ? { action: 'answer', text, sessionComplete: false, note: 'unstructured model output used as the answer' } : { action: 'wait', text: '', sessionComplete: false, note: 'empty model output' }
}

/** Strips markup a speech synthesizer would read aloud. */
export function cleanSpoken(text: string): string {
  return text.replace(/[*_#`>]/g, '').replace(/\[(?:pause|PAUSE)\]/g, '...').replace(/\s+/g, ' ').trim()
}
