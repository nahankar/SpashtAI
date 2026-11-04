import type { Feature, Membership } from '../client'

export type WorkspaceProductFeature = 'elevate' | 'replay' | 'interviews' | 'progress_pulse' | 'feedback'
export interface NavItem { to: string; label: string; feature?: WorkspaceProductFeature }

const LEARNER_NAV: NavItem[] = [
  { to: 'elevate', label: 'Elevate', feature: 'elevate' },
  { to: 'replay', label: 'Replay', feature: 'replay' },
  { to: 'interviews', label: 'Interviews', feature: 'interviews' },
  { to: 'progress', label: 'Progress Pulse', feature: 'progress_pulse' },
  { to: 'feedback', label: 'Feedback', feature: 'feedback' },
]

export const ADMIN_NAV_GROUPS: { label: string; links: NavItem[] }[] = [
  { label: 'Overview', links: [
    { to: 'admin', label: 'Dashboard' },
    { to: 'admin/users', label: 'Users' },
    { to: 'admin/sessions', label: 'Sessions' },
    { to: 'admin/invitations', label: 'Invitations' },
    { to: 'admin/feedback', label: 'Feedback' },
  ] },
  { label: 'Analytics', links: [
    { to: 'admin/feature-usage', label: 'Feature usage' },
    { to: 'admin/progress-pulse', label: 'Progress Pulse' },
    { to: 'admin/ai-analytics', label: 'AI Analytics' },
  ] },
  { label: 'Administration', links: [
    { to: 'admin/settings', label: 'Workspace settings' },
  ] },
]

export const ADMIN_NAV: NavItem[] = ADMIN_NAV_GROUPS.flatMap(group => group.links)

export function allowedFeatures(features: Feature[]): Record<string, boolean> {
  return Object.fromEntries(features.map(f => [f.feature, f.allowed === true]))
}

export function isManager(role: Membership['role']) {
  return role === 'OWNER' || role === 'ADMIN'
}

/** Learner links come only from this member's server decisions; admin links only for Owners and Admins. */
export function workspaceNav(role: Membership['role'], features: Feature[]) {
  const allowed = allowedFeatures(features)
  return {
    learner: LEARNER_NAV.filter(item => item.feature && allowed[item.feature]),
    admin: isManager(role) ? ADMIN_NAV : [],
  }
}

/** Why a product is unavailable, in words for the member; never implies the product is broken. */
export function unavailableReason(feature: Feature | undefined): string {
  if (!feature) return 'This product is not offered in this workspace.'
  if (feature.ready === false) return 'This product is not yet available in organization workspaces.'
  if (!feature.entitled) return 'This product is not included in your organization plan.'
  if (!feature.enabled) return 'Your organization has not turned this product on.'
  return 'Your workspace administrator has not given you access to this product.'
}

export interface AnalyticsFilters { days: number; learner?: string; product?: string; skill?: string }
export const PERIODS = [7, 14, 30, 60, 90] as const
export const PRODUCTS = [
  { id: 'elevate', label: 'Elevate' },
  { id: 'replay', label: 'Replay' },
  { id: 'interviews', label: 'Interviews' },
] as const

export function filterQuery(filters: AnalyticsFilters, extra: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams({ days: String(filters.days) })
  for (const [key, value] of Object.entries({ learner: filters.learner, product: filters.product, skill: filters.skill, ...extra })) {
    if (value) params.set(key, value)
  }
  return params.toString()
}

export function featureLabel(feature: string) {
  return ({ progress_pulse: 'Progress Pulse', audio_export: 'Audio export', text_export: 'Text export', app: 'App' } as Record<string, string>)[feature]
    ?? feature.charAt(0).toUpperCase() + feature.slice(1).replaceAll('_', ' ')
}

export function deliveryNotice(path: string, status?: string) {
  if (path.endsWith('/revoke')) return 'Invitation revoked.'
  if (status === 'DEV_CAPTURED') return 'Captured locally. No email was sent.'
  if (status === 'SENT') return 'Accepted by the mail server for delivery.'
  if (status === 'FAILED') return 'Invitation saved, but email was not sent. Ask the platform administrator to check email delivery, then resend.'
  return 'Invitation saved; delivery outcome is not yet available.'
}

export function canManage(actor: Membership['role'], target: Membership['role']) {
  return actor === 'OWNER' || target === 'LEARNER'
}

export function timeZones(current: string): string[] {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return zones.includes(current) ? zones : [current, ...zones]
}

export function rangeLabel(range?: { from: string; to: string; timeZone: string }) {
  return range ? `${range.from} to ${range.to} · days in ${range.timeZone}` : ''
}

export interface Plan { version: 1; title: string; report: 'overview' | 'daily_activity' | 'learner_activity' | 'feature_usage' | 'progress_pulse'; days: number; product: string | null; skill: string | null; explanation: string; learnerMemberId: string | null }
const REPORT_LABEL: Record<Plan['report'], string> = {
  overview: 'Overview', daily_activity: 'Daily activity', learner_activity: 'Learner activity', feature_usage: 'Feature usage', progress_pulse: 'Progress Pulse',
}

export function planSummary(plan: Plan, learnerName?: string) {
  return [REPORT_LABEL[plan.report], `last ${plan.days} days`, plan.product && featureLabel(plan.product), plan.skill && featureLabel(plan.skill),
    plan.learnerMemberId && (learnerName ?? 'one learner')].filter(Boolean).join(' · ')
}
