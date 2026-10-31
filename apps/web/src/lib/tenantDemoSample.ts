import type { Invitation, InvitationList, InvitationStatus } from '@/lib/invitations'

/**
 * Fictional, clearly labelled data for Tenant Admin demonstrations. No real account, invitation or analytics row is
 * used. Addresses use the reserved example.com domain. Dates are relative to `now` so the demo always looks current.
 */

export interface SampleLearner {
  id: string
  name: string
  email: string
  joinedAt: string
  lastActiveAt: string | null
  sessions: number
}

const DAY = 86_400_000
const iso = (now: number, daysAgo: number) => new Date(now - daysAgo * DAY).toISOString()

const LEARNERS: [string, number, number | null, number][] = [
  ['Sample Learner — Ananya', 41, 1, 18],
  ['Sample Learner — Bilal', 38, 2, 14],
  ['Sample Learner — Chen', 30, 0, 22],
  ['Sample Learner — Divya', 27, 6, 7],
  ['Sample Learner — Elena', 21, 3, 9],
  ['Sample Learner — Farhan', 16, null, 0],
  ['Sample Learner — Gauri', 12, 1, 5],
  ['Sample Learner — Hiro', 9, 4, 3],
  ['Sample Learner — Isha', 5, 0, 2],
]

export function sampleLearners(now = Date.now()): SampleLearner[] {
  return LEARNERS.map(([name, joined, active, sessions], i) => ({
    id: `sample-learner-${i + 1}`,
    name,
    email: `learner${i + 1}@example.com`,
    joinedAt: iso(now, joined),
    lastActiveAt: active === null ? null : iso(now, active),
    sessions,
  }))
}

function invitation(now: number, i: number, over: Partial<Invitation>): Invitation {
  return {
    id: `sample-invitation-${i}`,
    email: `invitee${i}@example.com`,
    recipientName: null,
    status: 'pending',
    deliveryStatus: 'SENT',
    deliveryError: null,
    sendCount: 1,
    lastSentAt: iso(now, 1),
    createdAt: iso(now, 1),
    expiresAt: iso(now, -6),
    acceptedAt: null,
    revokedAt: null,
    existingUserAtInvite: false,
    sample: true,
    ...over,
  }
}

export function sampleInvitations(now = Date.now()): Invitation[] {
  return [
    invitation(now, 1, { recipientName: 'Sample Invitee — Kavya', createdAt: iso(now, 0.2), lastSentAt: iso(now, 0.2), expiresAt: iso(now, -6.8) }),
    invitation(now, 2, { recipientName: 'Sample Invitee — Leo', createdAt: iso(now, 2), lastSentAt: iso(now, 2), expiresAt: iso(now, -5) }),
    // Delivery failed but the invitation itself is still pending.
    invitation(now, 3, { recipientName: 'Sample Invitee — Meera', deliveryStatus: 'FAILED', deliveryError: 'send_failed', createdAt: iso(now, 3), expiresAt: iso(now, -4) }),
    invitation(now, 4, { createdAt: iso(now, 6), lastSentAt: iso(now, 6), expiresAt: iso(now, -1) }),
    ...sampleLearners(now).slice(0, 6).map((l, i) => invitation(now, 10 + i, {
      email: l.email, recipientName: l.name, status: 'accepted', createdAt: iso(now, 45 - i * 6), acceptedAt: l.joinedAt, expiresAt: iso(now, 38 - i * 6),
    })),
    invitation(now, 20, { recipientName: 'Sample Invitee — Nikhil', status: 'expired', createdAt: iso(now, 20), expiresAt: iso(now, 13) }),
    invitation(now, 21, { status: 'expired', createdAt: iso(now, 15), expiresAt: iso(now, 8) }),
    invitation(now, 22, { recipientName: 'Sample Invitee — Omar', status: 'revoked', createdAt: iso(now, 11), revokedAt: iso(now, 10), expiresAt: iso(now, 4) }),
  ]
}

/** Filters, searches and paginates the sample invitations the same way the server list does. */
export function sampleInvitationList(opts: { status?: InvitationStatus; q?: string; page?: number; pageSize?: number }, now = Date.now()): InvitationList {
  const all = sampleInvitations(now)
  const q = opts.q?.trim().toLowerCase()
  const filtered = all.filter((inv) => (!opts.status || inv.status === opts.status)
    && (!q || inv.email.toLowerCase().includes(q) || (inv.recipientName ?? '').toLowerCase().includes(q)))
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  const count = (s: InvitationStatus) => all.filter((inv) => inv.status === s).length
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    counts: { pending: count('pending'), accepted: count('accepted'), expired: count('expired'), revoked: count('revoked') },
  }
}

// ---------------------------------------------------------------- sample organization analytics

/** Fictional organization name used throughout the demo. */
export const SAMPLE_ORG = 'Sample Organization'

export interface SampleFeatureUsage { feature: string; activeLearners: number; sessions: number; avgActiveMinutes: number; completionRate: number }
export const SAMPLE_FEATURE_USAGE: SampleFeatureUsage[] = [
  { feature: 'Elevate', activeLearners: 8, sessions: 54, avgActiveMinutes: 14, completionRate: 0.81 },
  { feature: 'Replay', activeLearners: 6, sessions: 23, avgActiveMinutes: 9, completionRate: 0.74 },
  { feature: 'Prepare', activeLearners: 5, sessions: 17, avgActiveMinutes: 21, completionRate: 0.65 },
  { feature: 'Interviews', activeLearners: 4, sessions: 11, avgActiveMinutes: 18, completionRate: 0.73 },
]
/** Weekly sessions per feature, oldest first. */
export const SAMPLE_WEEKLY_SESSIONS = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'].map((name, i) => ({
  name,
  Elevate: [3, 4, 6, 5, 7, 8, 10, 11][i],
  Replay: [1, 2, 2, 3, 3, 3, 4, 5][i],
  Prepare: [0, 1, 2, 2, 3, 2, 3, 4][i],
  Interviews: [0, 0, 1, 1, 2, 2, 2, 3][i],
}))

export interface SampleSkill { skill: string; first: number; latest: number; learners: number }
/** Average Progress Pulse score (1–10) at each learner's first and latest eligible session. */
export const SAMPLE_PULSE_SKILLS: SampleSkill[] = [
  { skill: 'Clarity', first: 5.4, latest: 6.6, learners: 7 },
  { skill: 'Confidence', first: 5.1, latest: 6.2, learners: 7 },
  { skill: 'Structure', first: 4.8, latest: 6.0, learners: 6 },
  { skill: 'Pace', first: 5.9, latest: 6.4, learners: 7 },
  { skill: 'Filler words', first: 5.2, latest: 5.9, learners: 6 },
]
export const SAMPLE_PULSE_TREND = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'].map((name, i) => ({
  name, average: [5.2, 5.3, 5.5, 5.6, 5.8, 5.9, 6.1, 6.2][i],
}))

export interface SampleAiAnswer { question: string; answer: string; figures: { label: string; value: string }[] }
/** Canned aggregate answers; the demo never runs real or saved queries and never shows an individual learner. */
export const SAMPLE_AI_ANSWERS: SampleAiAnswer[] = [
  {
    question: 'Which skill improved most this quarter?',
    answer: 'Structure improved most across the sample cohort, followed by Clarity.',
    figures: [{ label: 'Structure', value: '+1.2' }, { label: 'Clarity', value: '+1.2' }, { label: 'Confidence', value: '+1.1' }],
  },
  {
    question: 'How many learners practised at least weekly?',
    answer: '6 of 9 sample learners practised in at least 6 of the last 8 weeks.',
    figures: [{ label: 'Weekly practisers', value: '6' }, { label: 'Learners', value: '9' }],
  },
  {
    question: 'Which feature drives the most active time?',
    answer: 'Elevate accounts for the most practice time; Prepare sessions are the longest on average.',
    figures: [{ label: 'Elevate sessions', value: '54' }, { label: 'Prepare avg minutes', value: '21' }],
  },
]

export const SAMPLE_UX_PAGES = [
  { page: 'Home', views: 212, medianSeconds: 34 },
  { page: 'Elevate', views: 168, medianSeconds: 420 },
  { page: 'Replay results', views: 96, medianSeconds: 185 },
  { page: 'Prepare', views: 74, medianSeconds: 260 },
  { page: 'Progress Pulse', views: 61, medianSeconds: 48 },
]
export const SAMPLE_UX_FUNNEL = [
  { step: 'Opened practice', learners: 9 },
  { step: 'Started a session', learners: 8 },
  { step: 'Completed a session', learners: 7 },
  { step: 'Viewed feedback', learners: 6 },
]
