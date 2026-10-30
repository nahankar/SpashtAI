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
