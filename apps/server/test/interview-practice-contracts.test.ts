import { describe, expect, it } from 'vitest'
import { chunkSchema, startSchema } from '../src/interviews/practice/contracts'

describe('interview practice input boundaries', () => {
  const setup = { sessionId: 'session_1791800000000_ab123', track: 'Automation Testing', experienceBand: '2-5', startingDifficulty: 'Medium', recordingConsent: true }
  it('accepts several values per dimension, de-duplicated and sorted', () => {
    const parsed = startSchema.parse({ ...setup, experienceBand: ['5-8', '0-2', '5-8'], startingDifficulty: ['Medium', 'Simple'], track: ['B', 'A'] })
    expect(parsed.experienceBand).toEqual(['0-2', '5-8'])
    expect(parsed.startingDifficulty).toEqual(['Medium', 'Simple'].sort())
    expect(parsed.track).toEqual(['A', 'B'])
    expect(startSchema.safeParse({ ...setup, experienceBand: [] }).success).toBe(false)
    expect(startSchema.safeParse({ ...setup, experienceBand: ['0-2', 'Unknown'] }).success).toBe(false)
  })
  it('accepts the existing shared controller session ID and rejects caller-owned policy fields', () => {
    // Omitted means the plan default (resolved server-side); 30 and null (no time limit) are valid shapes.
    const { durationMinutes: _d, ...noDuration } = setup as typeof setup & { durationMinutes?: number }
    expect(startSchema.parse(noDuration).durationMinutes).toBeUndefined()
    expect(startSchema.parse({ ...setup, durationMinutes: 30 }).durationMinutes).toBe(30)
    expect(startSchema.parse({ ...setup, durationMinutes: null }).durationMinutes).toBeNull()
    expect(startSchema.safeParse({ ...setup, durationMinutes: 45 }).success).toBe(false)
    for (const extra of [{ ownerId: 'someone' }, { namespace: 'other-bank' }, { purpose: 'COMMUNICATION' }, { contextScope: 'COMMUNICATION_PROFILE' }]) {
      expect(startSchema.safeParse({ ...setup, ...extra }).success).toBe(false)
    }
    expect(startSchema.safeParse({ ...setup, sessionId: '../another-session' }).success).toBe(false)
    expect(startSchema.safeParse({ ...setup, experienceBand: 'Unknown' }).success).toBe(false)
    expect(startSchema.safeParse({ ...setup, recordingConsent: false }).success).toBe(false)
    const { recordingConsent: _consent, ...withoutConsent } = setup
    expect(startSchema.safeParse(withoutConsent).success).toBe(false)
  })
  it('preserves committed speech and excludes partial or assistant transcripts', () => {
    const turn = { segmentId: 'segment-1', sourceTurnId: 'user_turn_1', localTurnIndex: 1, role: 'user', text: '  Original wording, with spelling.  ' }
    expect(chunkSchema.parse(turn).text).toBe(turn.text)
    expect(chunkSchema.safeParse({ ...turn, partial: true }).success).toBe(false)
    expect(chunkSchema.safeParse({ ...turn, role: 'assistant' }).success).toBe(false)
    expect(chunkSchema.safeParse({ ...turn, text: '   ' }).success).toBe(false)
  })
})
