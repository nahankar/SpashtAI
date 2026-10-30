import { apiClient } from '@/lib/api-client'

/**
 * Platform learner invitations (Admin). These calls are platform-wide: nothing here is tenant-scoped yet, so
 * once real tenancy exists every list, count and action must be restricted to the active tenant.
 */

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'
export type DeliveryStatus = 'SENDING' | 'SENT' | 'FAILED' | 'DEV_CAPTURED'
export const INVITATION_STATUSES: InvitationStatus[] = ['pending', 'accepted', 'expired', 'revoked']

export interface Invitation {
  id: string
  email: string
  recipientName: string | null
  status: InvitationStatus
  deliveryStatus: DeliveryStatus
  deliveryError: string | null
  sendCount: number
  lastSentAt: string | null
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
  revokedAt: string | null
  existingUserAtInvite: boolean
  /** Fictional row shown only in the Tenant Admin demo; never sent to the server. */
  sample?: boolean
}

export interface InvitationList {
  items: Invitation[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  counts: Record<InvitationStatus, number>
}

export interface InvitationEmailConfig {
  mode: 'smtp' | 'dev_capture'
  expiryDays: number
  smtpReady: boolean
  missing: string[]
  optional: string[]
}

export interface CapturedInvitationEmail {
  id: string
  to: string
  subject: string
  text: string
  acceptUrl: string
  capturedAt: string
  developmentOnly: true
}

export function listInvitations(params: { status?: InvitationStatus; q?: string; page?: number; pageSize?: number }) {
  const search = new URLSearchParams()
  if (params.status) search.set('status', params.status)
  if (params.q) search.set('q', params.q)
  search.set('page', String(params.page ?? 1))
  search.set('pageSize', String(params.pageSize ?? 20))
  return apiClient<InvitationList>(`/api/admin/invitations?${search}`)
}

export function createInvitation(body: { email: string; name?: string; confirmExistingUser?: boolean }) {
  return apiClient<{ invitation: Invitation; notice: string }>('/api/admin/invitations', { method: 'POST', body: JSON.stringify(body) })
}

export function resendInvitation(id: string) {
  return apiClient<{ invitation: Invitation; notice: string }>(`/api/admin/invitations/${id}/resend`, { method: 'POST' })
}

export function revokeInvitation(id: string) {
  return apiClient<{ invitation: Invitation }>(`/api/admin/invitations/${id}/revoke`, { method: 'POST' })
}

export function getInvitationEmailConfig() {
  return apiClient<InvitationEmailConfig>('/api/admin/invitations/email-config')
}

export function getDevMailbox() {
  return apiClient<{ developmentOnly: true; messages: CapturedInvitationEmail[] }>('/api/admin/invitations/dev-mailbox')
}

export const STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  expired: 'Expired',
  revoked: 'Revoked',
}

/** Delivery is separate from invitation status: a failed email leaves the invitation pending. */
export function deliveryLabel(inv: Pick<Invitation, 'deliveryStatus' | 'deliveryError'>): { label: string; tone: 'ok' | 'warn' | 'error' | 'muted' } {
  switch (inv.deliveryStatus) {
    case 'SENT': return { label: 'Sent to mail server', tone: 'ok' }
    case 'DEV_CAPTURED': return { label: 'Captured (dev only, not sent)', tone: 'warn' }
    case 'SENDING': return { label: 'Sending…', tone: 'muted' }
    case 'FAILED': return { label: inv.deliveryError === 'smtp_not_configured' ? 'Not sent: email not configured' : 'Delivery failed', tone: 'error' }
  }
}

export function invitationDisplayName(inv: Pick<Invitation, 'recipientName' | 'email'>) {
  return inv.recipientName || inv.email
}

export function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}
