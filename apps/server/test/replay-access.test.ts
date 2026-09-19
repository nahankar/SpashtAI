import { describe, expect, it } from 'vitest'
import { replaySessionAccessWhere } from '../src/lib/replay-access'

describe('Replay session ownership selector', () => {
  it('scopes normal users to their own sessions', () => {
    expect(replaySessionAccessWhere('session-1', 'user-1', false)).toEqual({
      id: 'session-1',
      userId: 'user-1',
    })
  })

  it('allows privileged support access without weakening normal-user queries', () => {
    expect(replaySessionAccessWhere('session-1', 'admin-1', true)).toEqual({
      id: 'session-1',
    })
  })
})
