import { z } from 'zod'

export const WORKSPACE_FEATURES = ['coach', 'elevate', 'replay', 'interviews', 'prepare', 'progress_pulse',
  'feedback', 'pro', 'ultra', 'audio_export', 'text_export', 'reprocess'] as const
export const featureSchema = z.enum(WORKSPACE_FEATURES)
export const memberRoleSchema = z.enum(['OWNER', 'ADMIN', 'LEARNER'])
export const idSchema = z.string().min(1).max(160)
const reserved = new Set(['personal', 'admin', 'api', 'auth', 'www', 'app', 'login', 'signup', 'settings', 'support', 'spashtai'])
export const slugSchema = z.string().trim().toLowerCase().min(3).max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine(s => !reserved.has(s) && !s.startsWith('personal-'), 'That workspace address is reserved')
export const timeZoneSchema = z.string().min(1).max(80).refine(zone => {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return true } catch { return false }
}, 'Unknown time zone')

/** Stored inline, so logos cannot become script, external tracking or arbitrary remote fetches. */
export const logoSchema = z.string().max(90_000).refine(value => {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) return false
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > 65_536 || bytes.toString('base64') !== match[2]) return false
  if (match[1] === 'png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  if (match[1] === 'jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
}, 'Use a PNG, JPEG or WebP logo up to 64 KB').nullable()

export const brandingSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  logoDataUrl: logoSchema.optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  timeZone: timeZoneSchema.optional(),
}).strict()
export const limitsSchema = z.object({
  maxMembers: z.number().int().min(1).max(100_000),
  dailyEvaluations: z.number().int().min(0).max(100_000),
  concurrentVoice: z.number().int().min(1).max(1_000),
}).strict()
export const createWorkspaceSchema = brandingSchema.extend({
  name: z.string().trim().min(2).max(100), slug: slugSchema,
  ownerEmail: z.string().trim().toLowerCase().email().max(254),
  limits: limitsSchema.optional(),
}).strict()
export const featureSettingsSchema = z.object({
  enabled: z.boolean(), memberDefault: z.boolean(),
}).strict()
export const platformFeatureSchema = featureSettingsSchema.extend({ entitled: z.boolean() }).strict()
export const updateMemberSchema = z.object({
  role: memberRoleSchema.optional(), state: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
}).strict().refine(v => v.role !== undefined || v.state !== undefined, 'Choose a role or state change')

export class WorkspaceError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message); this.status = status; this.code = code
  }
}

export function workspacesEnabled() { return process.env.WORKSPACES_ENABLED === 'true' }

export type FeatureDecision = { entitled: boolean; enabled: boolean; memberDefault: boolean }
export function effectiveWorkspaceFeature(input: {
  workspaceActive: boolean; memberActive: boolean; tenantReady: boolean; platformAllowed: boolean;
  policy?: FeatureDecision; memberOverride?: boolean;
}) {
  if (!input.workspaceActive) return { allowed: false, reason: 'WORKSPACE_SUSPENDED' }
  if (!input.memberActive) return { allowed: false, reason: 'MEMBERSHIP_INACTIVE' }
  if (!input.platformAllowed) return { allowed: false, reason: 'PLATFORM_UNAVAILABLE' }
  if (!input.policy?.entitled) return { allowed: false, reason: 'NOT_ENTITLED' }
  if (!input.policy.enabled) return { allowed: false, reason: 'WORKSPACE_DISABLED' }
  if (!(input.memberOverride ?? input.policy.memberDefault)) return { allowed: false, reason: 'MEMBER_DISABLED' }
  if (!input.tenantReady) return { allowed: false, reason: 'WORKSPACE_ISOLATION_PENDING' }
  return { allowed: true, reason: null }
}
