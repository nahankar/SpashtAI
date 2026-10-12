import type { ChatMessage } from '@/features/live-session/types'
import type { InterviewAttempt } from './interview-practice'

/** Supply the existing conversation panel with one bubble per question/answer.
 * Source chunks stay unchanged; segment + turn identity prevents duplicates
 * when live notifications overlap saved history or the same question resumes.
 */
export function interviewConversation(attempts: InterviewAttempt[], live: ChatMessage[], startedAt: string): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (const attempt of attempts) {
    const marker = `answer_${attempt.id}::`
    const liveParts = live.flatMap(message => {
      const position = message.id?.lastIndexOf(marker) ?? -1
      return message.role === 'user' && position >= 0
        ? [{ key: message.id!.slice(position + marker.length), text: message.content, timestamp: message.timestamp }]
        : []
    })
    const parts = new Map<string, { text: string; timestamp: string }>()
    for (const part of attempt.capturedParts ?? []) {
      parts.set(`${part.segmentId}::${part.sourceTurnId}`, { text: part.text, timestamp: part.createdAt })
    }
    for (const part of liveParts) {
      // Saved provider-final chunks are authoritative if the notification differs.
      if (!parts.has(part.key)) parts.set(part.key, part)
    }
    const questionSpoken = !!attempt.askedAt || live.some(message => message.role === 'assistant' && message.id?.endsWith(`question_${attempt.id}`))
    const answer = attempt.answer?.answerText ?? (parts.size
      ? [...parts.values()].map(part => part.text).join(' ')
      : attempt.capturedText)
    if (!questionSpoken && !answer && attempt.status === 'PREPARED') continue
    const questionTime = attempt.askedAt ?? startedAt
    messages.push({ id: `interview_question_${attempt.id}`, role: 'assistant', content: attempt.question.text, timestamp: questionTime })
    if (answer?.trim()) {
      const firstPart = parts.values().next().value
      messages.push({ id: `interview_answer_${attempt.id}`, role: 'user',
        content: answer.replace(/\s+/g, ' ').trim(), timestamp: firstPart?.timestamp ?? questionTime })
    }
  }
  return messages
}
