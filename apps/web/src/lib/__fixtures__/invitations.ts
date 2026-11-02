import type { Invitation, InvitationList, InvitationStatus } from '@/lib/invitations'

/**
 * Test/development fixtures: fictional invitations on the reserved example.com domain, covering every status and a
 * failed delivery. Never imported by production code. Dates are relative to `now`.
 */

const DAY = 86_400_000
const iso = (now: number, daysAgo: number) => new Date(now - daysAgo * DAY).toISOString()

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
    ...[0, 1, 2, 3, 4, 5].map((i) => invitation(now, 10 + i, {
      email: `learner${i + 1}@example.com`, recipientName: `Sample Learner ${i + 1}`, status: 'accepted',
      createdAt: iso(now, 45 - i * 6), acceptedAt: iso(now, 41 - i * 6), expiresAt: iso(now, 38 - i * 6),
    })),
    invitation(now, 20, { recipientName: 'Sample Invitee — Nikhil', status: 'expired', createdAt: iso(now, 20), expiresAt: iso(now, 13) }),
    invitation(now, 21, { status: 'expired', createdAt: iso(now, 15), expiresAt: iso(now, 8) }),
    invitation(now, 22, { recipientName: 'Sample Invitee — Omar', status: 'revoked', createdAt: iso(now, 11), revokedAt: iso(now, 10), expiresAt: iso(now, 4) }),
  ]
}

/** Filters, searches and paginates the fixture the same way the server list does. */
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
