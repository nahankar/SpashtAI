import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

/**
 * Disposable learners for individual/daily analytics tests. Every row hangs off users created here, so deleting the
 * users (cascade) removes everything. Times are fixed so IST day boundaries are deterministic.
 */
export const FIXTURE_NOW = new Date('2026-10-31T06:30:00Z') // 31 Oct, 12:00 IST
const at = (iso: string) => new Date(iso)
const replayOrigin = { evidenceOrigin: 'replay-server-assessment-v1' }

export async function createLearnerFixture(prisma: PrismaClient) {
  const tag = `la_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const user = (email: string, data: Record<string, unknown> = {}) => prisma.user.create({ data: { email: `${tag}_${email}@example.invalid`, ...data } })
  const admin = await user('admin', { role: 'ADMIN', firstName: 'Fixture', lastName: 'Admin' })
  // Same display name, different accounts: selection must use the id.
  const asha = await user('asha.one', { firstName: 'Asha', lastName: `Rao ${tag}`, gender: 'FEMALE', city: 'Pune', state: 'Maharashtra' })
  const twin = await user('asha.two', { firstName: 'Asha', lastName: `Rao ${tag}`, gender: 'MALE', city: 'Mysuru', state: 'Karnataka' })
  // Activity but no Pulse scores.
  const quiet = await user('quiet', { firstName: 'Quiet', lastName: `Learner ${tag}`, gender: 'FEMALE' })

  const session = (userId: string, startedAt: string, data: Record<string, unknown> = {}) =>
    prisma.session.create({ data: { userId, module: 'elevate', startedAt: at(startedAt), ...data } })
  const s1 = await session(asha.id, '2026-10-20T04:00:00Z', { endedAt: at('2026-10-20T04:20:00Z'), progressPulseStatus: 'tracked' })
  const s2 = await session(asha.id, '2026-10-25T05:00:00Z', { endedAt: at('2026-10-25T05:15:00Z'), progressPulseStatus: 'tracked' })
  // 18:45 UTC on 28 Oct is 00:15 IST on 29 Oct.
  const s3 = await session(asha.id, '2026-10-28T18:45:00Z', { endedAt: at('2026-10-28T19:00:00Z') }) // ended, no decision
  const s4 = await session(asha.id, '2026-10-31T05:00:00Z') // still open
  const interview = await session(asha.id, '2026-10-26T06:00:00Z', { purpose: 'INTERVIEW', endedAt: at('2026-10-26T06:30:00Z') })
  const r1 = await prisma.replaySession.create({ data: { userId: asha.id, meetingType: 'standup', userRole: 'speaker', focusAreas: [],
    status: 'completed', progressPulseStatus: 'tracked', createdAt: at('2026-10-27T08:00:00Z') } })
  const r2 = await prisma.replaySession.create({ data: { userId: asha.id, meetingType: 'standup', userRole: 'speaker', focusAreas: [],
    status: 'completed', progressPulseStatus: 'skipped', createdAt: at('2026-10-22T08:00:00Z') } })

  const pulse = (skill: string, score: number, source: string, sessionId: string | null, recordedAt: string, metadata?: object) =>
    ({ userId: asha.id, skill, score, source, sessionId, recordedAt: at(recordedAt), metadata })
  await prisma.progressPulse.createMany({ data: [
    pulse('clarity', 5, 'elevate', s1.id, '2026-10-20T04:20:00Z'),
    pulse('pacing', 6, 'elevate', s1.id, '2026-10-20T04:20:00Z'),
    pulse('clarity', 7, 'elevate', s2.id, '2026-10-25T05:15:00Z'),
    pulse('pacing', 6.1, 'elevate', s2.id, '2026-10-25T05:15:00Z'),
    pulse('confidence', 8, 'elevate', s2.id, '2026-10-25T05:15:00Z'), // single observation: no change
    pulse('structure', 6, 'replay', r1.id, '2026-10-27T08:10:00Z', replayOrigin), // validated Replay evidence
    pulse('clarity', 1, 'replay', r2.id, '2026-10-22T08:10:00Z'), // legacy Replay: excluded
    pulse('clarity', 9, 'interviews', interview.id, '2026-10-26T06:30:00Z'), // never Pulse-eligible
    pulse('engagement', 4, 'elevate', s3.id, '2026-10-28T18:59:00Z'), // IST 29 Oct
  ] })

  const event = (userId: string, feature: string, action: string, timestamp: string, extra: Record<string, unknown> = {}) =>
    ({ userId, feature, action, timestamp: at(timestamp), eventId: `${tag}_${randomUUID()}`, ...extra })
  await prisma.featureUsage.createMany({ data: [
    event(asha.id, 'elevate', 'page_view', '2026-10-20T03:58:00Z', { path: '/elevate', engagementMs: 60_000 }),
    event(asha.id, 'elevate', 'session_start', '2026-10-20T04:00:00Z', { sessionId: s1.id }),
    event(asha.id, 'elevate', 'session_end', '2026-10-20T04:20:00Z', { sessionId: s1.id, duration: 1200 }),
    event(asha.id, 'interviews', 'page_view', '2026-10-26T05:59:00Z', { path: '/interviews', engagementMs: 30_000 }),
    event(asha.id, 'elevate', 'session_start', '2026-10-28T18:45:00Z', { sessionId: s3.id }), // IST 29 Oct
    event(quiet.id, 'replay', 'page_view', '2026-10-27T10:00:00Z', { path: '/replay', engagementMs: 45_000 }),
    event(quiet.id, 'prepare', 'page_view', '2026-10-27T10:05:00Z', { path: '/prepare' }),
    event(admin.id, 'elevate', 'page_view', '2026-10-27T10:00:00Z', { path: '/elevate' }), // admin: excluded
  ] })
  return { tag, admin, asha, twin, quiet, sessions: { s1, s2, s3, s4, interview }, replays: { r1, r2 },
    cleanup: async () => {
      // AdminAction has no foreign key, so audit rows written during the test are removed explicitly.
      await prisma.adminAction.deleteMany({ where: { adminId: admin.id } })
      await prisma.user.deleteMany({ where: { email: { startsWith: `${tag}_` } } })
    } }
}
export type LearnerFixture = Awaited<ReturnType<typeof createLearnerFixture>>
