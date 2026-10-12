import type { Prisma } from '@prisma/client'
import { questionSnapshotSchema } from '../evaluator/contracts'

/** Read-only presentation for playback, including sessions ended before this
 * view existed. Raw chunks/turns stay intact for recording alignment. */
export async function readInterviewPlaybackConversation(tx: Pick<Prisma.TransactionClient, 'interviewAttempt'>, runId: string) {
    const attempts = await tx.interviewAttempt.findMany({ where: { runId }, orderBy: { index: 'asc' },
      include: { chunks: { include: { segment: { select: { segmentIndex: true } } } },
        answerSnapshots: { orderBy: { textRevision: 'desc' }, take: 1, select: { answerText: true } } } })
    return attempts.flatMap(attempt => {
      if (!attempt.askedAt) return []
      const chunks = attempt.chunks.sort((a,b) => a.segment.segmentIndex-b.segment.segmentIndex || a.localTurnIndex-b.localTurnIndex)
      const answer = attempt.answerSnapshots[0]?.answerText ?? chunks.map(c => c.text).join(' ')
      const questionTime = attempt.askedAt.toISOString()
      return [
        { id: `interview_question_${attempt.id}`, role: 'assistant', content: questionSnapshotSchema.parse(attempt.questionSnapshot).questionText, timestamp: questionTime },
        ...(answer.trim() ? [{ id: `interview_answer_${attempt.id}`, role: 'user', content: answer.replace(/\s+/g, ' ').trim(),
          timestamp: chunks[0]?.createdAt.toISOString() ?? questionTime }] : []),
      ]
    })
}

/** Derived replay data. Immutable answer chunks remain authoritative. Caller holds the Session lock. */
export async function projectInterviewTranscript(tx: Prisma.TransactionClient, runId: string, sessionId: string) {
    const attempts = await tx.interviewAttempt.findMany({ where: { runId }, orderBy: { index: 'asc' },
      include: { chunks: { include: { segment: { select: { segmentIndex: true } } } } } })
    const messages: Array<{ role: string; content: string; timestamp: string }> = []
    const turns: Array<{ sessionId: string; segmentId: string | null; turnIndex: number; localTurnIndex: number; sequenceNo: number; role: string; text: string }> = []
    const localIndexes = new Map<string,number>()
    for (const attempt of attempts) {
      if (attempt.askedAt) {
        const text = questionSnapshotSchema.parse(attempt.questionSnapshot).questionText
        messages.push({ role: 'assistant', content: text, timestamp: attempt.askedAt.toISOString() })
        turns.push({ sessionId: sessionId, segmentId: null, turnIndex: turns.length, localTurnIndex: turns.length, sequenceNo: turns.length, role: 'assistant', text })
      }
      for (const c of attempt.chunks.sort((a,b) => a.segment.segmentIndex-b.segment.segmentIndex || a.localTurnIndex-b.localTurnIndex)) {
        messages.push({ role: 'user', content: c.text, timestamp: c.createdAt.toISOString() })
        const local = localIndexes.get(c.segmentId) ?? 0; localIndexes.set(c.segmentId, local+1)
        turns.push({ sessionId: sessionId, segmentId: c.segmentId, turnIndex: turns.length, localTurnIndex: local, sequenceNo: turns.length, role: 'user', text: c.text })
      }
    }
    // Derived replay/communication view only. Never replace authoritative chunks
    // or answer snapshots, and never invent audio timing or subject scores.
    await tx.sessionTranscript.upsert({ where: { sessionId: sessionId }, create: { sessionId: sessionId,
      conversationData: { source: 'interview-capture-1', messages } }, update: { conversationData: { source: 'interview-capture-1', messages } } })
    if (turns.length) await tx.sessionTurn.createMany({ data: turns, skipDuplicates: true })
}
