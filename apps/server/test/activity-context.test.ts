import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: { findFirst: vi.fn(), count: vi.fn() },
  replaySession: { findFirst: vi.fn(), findUnique: vi.fn() },
  progressPulse: { findMany: vi.fn() },
  enabled: vi.fn(), journey: vi.fn(),
}))
vi.mock('../src/lib/prisma', () => ({ prisma: mocks }))
vi.mock('../src/lib/featureFlags', () => ({ getEnabledFeatures: mocks.enabled }))
vi.mock('../src/lib/prepareCoachingContext', () => ({ buildPrepareJourneyContext: mocks.journey }))
import { getCoachingContextForAgent } from '../src/routes/progress-pulse'

function response() {
  const res: any = { statusCode: 200, body: null }
  res.status = vi.fn((code) => { res.statusCode = code; return res })
  res.json = vi.fn((body) => { res.body = body; return res })
  return res
}
const req: any = { query: { sessionId: 's1', focusArea: 'clarity' }, header: () => 'context-test-token' }
describe('agent context isolation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.INTERNAL_AGENT_TOKEN = 'context-test-token'
    mocks.session.findFirst.mockResolvedValueOnce({ userId: 'u1' })
    mocks.enabled.mockResolvedValue(['elevate', 'replay'])
    mocks.progressPulse.findMany.mockResolvedValue([])
    mocks.replaySession.findFirst.mockResolvedValue(null)
    mocks.session.count.mockResolvedValue(0)
  })
  it('does not query communication history for fresh interview practice', async () => {
    mocks.session.findFirst.mockResolvedValue({ purpose: 'INTERVIEW', contextScope: 'SESSION_ONLY', focusContext: 'Java interview' })
    const res = response()
    await getCoachingContextForAgent(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.lastPracticeSummary).toBeNull()
    expect(mocks.progressPulse.findMany).not.toHaveBeenCalled()
    expect(mocks.replaySession.findFirst).not.toHaveBeenCalled()
  })
  it('returns only journey context, without global profile queries', async () => {
    mocks.session.findFirst.mockResolvedValue({ purpose: 'INTERVIEW', contextScope: 'JOURNEY', preparationPractice: { id: 'p1' } })
    mocks.journey.mockResolvedValue({ preparationId: 'j1', roleTitle: 'Engineer' })
    const res = response()
    await getCoachingContextForAgent(req, res)
    expect(res.body.prepareJourney.preparationId).toBe('j1')
    expect(mocks.progressPulse.findMany).not.toHaveBeenCalled()
  })
  it('does not fall back to global history when journey context is unavailable', async () => {
    mocks.session.findFirst.mockResolvedValue({ purpose: 'INTERVIEW', contextScope: 'JOURNEY', preparationPractice: { id: 'p1' } })
    mocks.journey.mockResolvedValue(null)
    const res = response()
    await getCoachingContextForAgent(req, res)
    expect(res.statusCode).toBe(500)
    expect(mocks.progressPulse.findMany).not.toHaveBeenCalled()
  })
  it('preserves communication-profile queries for ordinary Elevate', async () => {
    mocks.session.findFirst.mockResolvedValueOnce({ purpose: 'COMMUNICATION', contextScope: 'COMMUNICATION_PROFILE' }).mockResolvedValue(null)
    const res = response()
    await getCoachingContextForAgent(req, res)
    expect(res.statusCode).toBe(200)
    expect(mocks.progressPulse.findMany).toHaveBeenCalled()
    expect(mocks.replaySession.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ purpose: 'COMMUNICATION' }) }))
  })
  it('returns empty context for a recorded session without querying live history', async () => {
    mocks.session.findFirst.mockReset().mockResolvedValue(null)
    mocks.replaySession.findUnique.mockResolvedValue({ userId: 'u1' })
    const res = response()
    await getCoachingContextForAgent(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.skillSummaries).toEqual({})
    expect(mocks.progressPulse.findMany).not.toHaveBeenCalled()
    expect(mocks.journey).not.toHaveBeenCalled()
  })
  it('returns 404 for an unknown activity rather than profile history', async () => {
    mocks.session.findFirst.mockReset().mockResolvedValue(null)
    mocks.replaySession.findUnique.mockResolvedValue(null)
    const res = response()
    await getCoachingContextForAgent(req, res)
    expect(res.statusCode).toBe(404)
    expect(mocks.progressPulse.findMany).not.toHaveBeenCalled()
  })
})
