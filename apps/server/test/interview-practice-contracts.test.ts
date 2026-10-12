import { describe, expect, it } from 'vitest'
import { chunkSchema, startSchema } from '../src/interviews/practice/contracts'

describe('interview practice input boundaries', () => {
  const setup = { sessionId: 'session_1791800000000_ab123', track: 'Automation Testing', experienceBand: '2-5', startingDifficulty: 'Medium' }
  it('accepts the existing shared controller session ID and rejects caller-owned policy fields', () => {
    expect(startSchema.parse(setup).durationMinutes).toBe(10)
    for (const extra of [{ ownerId: 'someone' }, { namespace: 'other-bank' }, { purpose: 'COMMUNICATION' }, { contextScope: 'COMMUNICATION_PROFILE' }]) {
      expect(startSchema.safeParse({ ...setup, ...extra }).success).toBe(false)
    }
    expect(startSchema.safeParse({ ...setup, sessionId: '../another-session' }).success).toBe(false)
    expect(startSchema.safeParse({ ...setup, experienceBand: 'Unknown' }).success).toBe(false)
  })
  it('preserves committed speech and excludes partial or assistant transcripts', () => {
    const turn = { segmentId: 'segment-1', sourceTurnId: 'user_turn_1', localTurnIndex: 1, role: 'user', text: '  Original wording, with spelling.  ' }
    expect(chunkSchema.parse(turn).text).toBe(turn.text)
    expect(chunkSchema.safeParse({ ...turn, partial: true }).success).toBe(false)
    expect(chunkSchema.safeParse({ ...turn, role: 'assistant' }).success).toBe(false)
    expect(chunkSchema.safeParse({ ...turn, text: '   ' }).success).toBe(false)
  })
})
