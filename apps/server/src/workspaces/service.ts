import { readEnrollmentSettings } from './enrollment'
import { reservedWorkspaceSeats } from './invitations'
import { z } from 'zod'
import type { Workspace } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { signWorkspaceToken } from '../lib/jwt'
import {
  brandingSchema, createWorkspaceSchema, effectiveWorkspaceFeature, featureSettingsSchema,
  featureSchema, limitsSchema, platformFeatureSchema, updateMemberSchema, WORKSPACE_FEATURES, WorkspaceError,
} from './contracts'
import { establishWorkspace, requireWorkspaceManager, withPlatformWorkspaceAdmin, withWorkspaceActor, type WorkspaceTx } from './context'

export const WORKSPACE_INTEGRATION_NOTICE = 'Organization practices and analytics are not enabled yet. Personal history remains separate.'

export function presentWorkspace(workspace: Workspace) {
  return { id: workspace.id, slug: workspace.kind === 'PERSONAL' ? 'personal' : workspace.slug,
    enrollmentSettings: readEnrollmentSettings(workspace.enrollmentSettings), name: workspace.kind === 'PERSONAL' ? 'Personal' : workspace.name, kind: workspace.kind, state: workspace.state,
    logoDataUrl: workspace.logoDataUrl, accentColor: workspace.accentColor, timeZone: workspace.timeZone,
    isolationStage: workspace.isolationStage, limits: { maxMembers: workspace.maxMembers,
      dailyEvaluations: workspace.dailyEvaluations, concurrentVoice: workspace.concurrentVoice } }
}

async function audit(tx: WorkspaceTx, workspaceId: string, actorUserId: string, action: string, subjectId?: string, metadata: Prisma.InputJsonObject = {}) {
  await tx.workspaceAudit.create({ data: { workspaceId, actorUserId, action, subjectId, metadata } })
}

/** No old session/recording/score is rewritten: existing ownership remains the Personal data plane. */
async function ensurePersonal(tx: WorkspaceTx, userId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`personal-workspace:${userId}`}, 0))::text`
  let workspace = await tx.workspace.findUnique({ where: { personalOwnerId: userId } })
  if (!workspace) workspace = await tx.workspace.create({ data: { kind: 'PERSONAL', name: 'Personal',
    slug: `personal-${userId.toLowerCase()}`, personalOwnerId: userId, isolationStage: 'PERSONAL_LEGACY', maxMembers: 1 } })
  await tx.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
    create: { workspaceId: workspace.id, userId, role: 'OWNER', state: 'ACTIVE', acceptedAt: new Date() }, update: {} })
  return workspace
}

export function listMyWorkspaces(userId: string) {
  return withWorkspaceActor(userId, async tx => {
    await ensurePersonal(tx, userId)
    const rows = await tx.workspaceMember.findMany({ where: { userId, state: { not: 'SUSPENDED' } },
      include: { workspace: true }, orderBy: { createdAt: 'asc' } })
    return rows.sort((a, b) => Number(b.workspace.kind === 'PERSONAL') - Number(a.workspace.kind === 'PERSONAL')).map(member => ({ ...presentWorkspace(member.workspace), membership: { id: member.id, role: member.role, state: member.state },
      path: member.workspace.kind === 'PERSONAL' ? '/coach' : `/w/${member.workspace.slug}` }))
  })
}

export function enterWorkspace(userId: string, slug: string) {
  return withWorkspaceActor(userId, async tx => {
    const scope = await establishWorkspace(tx, userId, slug)
    const member = scope.member
    return { workspace: presentWorkspace(scope.workspace), membership: { id: member.id, role: member.role, state: member.state },
      accessToken: member.state === 'ACTIVE' ? signWorkspaceToken({ userId, workspaceId: scope.workspace.id, membershipId: member.id }) : null,
      expiresInSeconds: member.state === 'ACTIVE' ? 900 : 0, notice: WORKSPACE_INTEGRATION_NOTICE }
  })
}

export function acceptWorkspaceMembership(userId: string, slug: string) {
  return withWorkspaceActor(userId, async tx => {
    const { workspace } = await establishWorkspace(tx, userId, slug)
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${workspace.id} FOR UPDATE`
    await establishWorkspace(tx, userId, slug)
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerified: true } })
    if (!user.emailVerified) throw new WorkspaceError(403, 'VERIFIED_EMAIL_REQUIRED', 'Verify your sign-in email before accepting workspace access')
    const changed = await tx.workspaceMember.updateMany({ where: { workspaceId: workspace.id, userId, state: 'INVITED' },
      data: { state: 'ACTIVE', acceptedAt: new Date() } })
    if (changed.count) await audit(tx, workspace.id, userId, 'membership_accepted')
    return { accepted: true }
  })
}

export function listPlatformWorkspaces(actorId: string) {
  return withPlatformWorkspaceAdmin(actorId, async tx => {
    const rows = await tx.workspace.findMany({ where: { kind: 'ORGANIZATION' }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { _count: { select: { members: { where: { state: { not: 'SUSPENDED' } } } } }, features: true, members: { where: { role: 'OWNER' }, select: { id: true, state: true, user: { select: { email: true } } } } } })
    return rows.map(row => ({ ...presentWorkspace(row), members: row._count.members, features: row.features,
      createdAt: row.createdAt, owners: row.members.map(m => ({ id: m.id, email: m.user.email, state: m.state })) }))
  })
}

export function createOrganization(actorId: string, input: unknown) {
  const body = createWorkspaceSchema.parse(input)
  return withPlatformWorkspaceAdmin(actorId, async tx => {
    const owner = await tx.user.findFirst({ where: { email: { equals: body.ownerEmail, mode: 'insensitive' }, emailVerified: true }, select: { id: true } })
    if (!owner) throw new WorkspaceError(409, 'OWNER_ACCOUNT_REQUIRED', 'The initial Owner needs a verified SpashtAI account. Invite them to SpashtAI first, then create the workspace.')
    const branding = brandingSchema.parse({ name: body.name, logoDataUrl: body.logoDataUrl, accentColor: body.accentColor, timeZone: body.timeZone })
    const limits = body.limits
    const row = await tx.workspace.create({ data: { ...branding, name: body.name, slug: body.slug, ...limits, kind: 'ORGANIZATION', isolationStage: 'FOUNDATION_ONLY',
      members: { create: { userId: owner.id, role: 'OWNER', state: 'INVITED' } },
      features: { create: WORKSPACE_FEATURES.map(feature => ({ feature, entitled: false, enabled: false })) } } })
    await audit(tx, row.id, actorId, 'workspace_created', owner.id, { membershipState: 'INVITED', emailSent: false })
    return { workspace: presentWorkspace(row), ownerMembershipState: 'INVITED', emailSent: false, notice: WORKSPACE_INTEGRATION_NOTICE }
  })
}

export function updatePlatformWorkspace(actorId: string, workspaceId: string, input: unknown) {
  const body = brandingSchema.extend({ state: z.enum(['ACTIVE', 'SUSPENDED']).optional(), limits: limitsSchema.optional() }).strict().parse(input)
  return withPlatformWorkspaceAdmin(actorId, async tx => {
    const workspace = await tx.workspace.findFirst({ where: { id: workspaceId, kind: 'ORGANIZATION' } })
    if (!workspace) throw new WorkspaceError(404, 'WORKSPACE_NOT_FOUND', 'Organization workspace not found')
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${workspaceId} FOR UPDATE`
    const { limits, ...settings } = body
    if (limits) {
      const seats = await reservedWorkspaceSeats(tx, workspaceId)
      if (limits.maxMembers < seats) throw new WorkspaceError(409, 'SEAT_LIMIT_BELOW_MEMBERS', 'The seat limit cannot be lower than current members and invitations')
    }
    const row = await tx.workspace.update({ where: { id: workspaceId }, data: { ...settings, ...limits } })
    await audit(tx, workspaceId, actorId, 'workspace_updated', undefined, { fields: Object.keys(body) })
    return presentWorkspace(row)
  })
}


export async function workspaceSnapshot(tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>) {
  const { workspace, member } = scope
  const flags = await tx.platformFeatureFlag.findMany()
  const grants = await tx.userFeatureGrant.findMany({ where: { userId: member.userId }, select: { feature: true } })
  const policies = await tx.workspaceFeature.findMany({ where: { workspaceId: workspace.id } })
  const overrides = await tx.workspaceMemberFeature.findMany({ where: { workspaceId: workspace.id, memberId: member.id } })
  const features = WORKSPACE_FEATURES.map(feature => {
    const platform = flags.find(row => row.feature === feature)
    const platformAllowed = platform
      ? !platform.hidden && !platform.disabled && (platform.audience === 'EVERYONE' || grants.some(grant => grant.feature === feature))
      : !['interviews', 'prepare'].includes(feature)
    const policy = policies.find(row => row.feature === feature)
    const decision = effectiveWorkspaceFeature({ workspaceActive: workspace.state === 'ACTIVE', memberActive: member.state === 'ACTIVE',
      // No organization product route is certified by this foundation. A setting cannot bypass this boundary.
      tenantReady: false, platformAllowed,
      policy, memberOverride: overrides.find(row => row.feature === feature)?.allowed })
    return { feature, entitled: policy?.entitled ?? false, enabled: policy?.enabled ?? false,
      memberDefault: policy?.memberDefault ?? true, ...decision }
  })
  const counts = member.role === 'LEARNER' ? null : {
    active: await tx.workspaceMember.count({ where: { workspaceId: workspace.id, state: 'ACTIVE' } }),
    invited: await tx.workspaceMember.count({ where: { workspaceId: workspace.id, state: 'INVITED' } }),
    suspended: await tx.workspaceMember.count({ where: { workspaceId: workspace.id, state: 'SUSPENDED' } }),
  }
  return { workspace: presentWorkspace(workspace), membership: { id: member.id, role: member.role, state: member.state },
    counts, features, notice: WORKSPACE_INTEGRATION_NOTICE, emailInvitationsReady: true }
}

export async function listWorkspaceMembers(tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>) {
  requireWorkspaceManager(scope)
  const rows = await tx.workspaceMember.findMany({ where: { workspaceId: scope.workspace.id },
    include: { user: { select: { firstName: true, lastName: true, email: true } }, features: true }, orderBy: { createdAt: 'asc' }, take: 100 })
  return rows.map(row => ({ id: row.id, role: row.role, state: row.state, acceptedAt: row.acceptedAt,
    enrollmentResponses: row.enrollmentResponses, enrollmentFields: row.enrollmentFields, name: [row.user.firstName, row.user.lastName].filter(Boolean).join(' '), email: row.user.email, features: row.features.map(f => ({ feature: f.feature, allowed: f.allowed })) }))
}

export async function configureWorkspaceFeature(tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>, feature: string, input: unknown) {
  requireWorkspaceManager(scope)
  const body = featureSettingsSchema.parse(input)
  const featureId = featureSchema.parse(feature)
  const current = await tx.workspaceFeature.findUnique({ where: { workspaceId_feature: { workspaceId: scope.workspace.id, feature: featureId } } })
  if (!current || (body.enabled && !current.entitled)) throw new WorkspaceError(403, 'NOT_ENTITLED', 'This feature has not been granted to the workspace')
  const row = await tx.workspaceFeature.update({ where: { workspaceId_feature: { workspaceId: scope.workspace.id, feature: featureId } }, data: body })
  await audit(tx, scope.workspace.id, scope.member.userId, 'workspace_feature_updated', featureId, body)
  return { feature: row.feature, entitled: row.entitled, enabled: row.enabled, memberDefault: row.memberDefault }
}

export function configurePlatformFeature(actorId: string, workspaceId: string, feature: string, input: unknown) {
  const body = platformFeatureSchema.parse(input); const featureId = featureSchema.parse(feature)
  if (body.enabled && !body.entitled) throw new WorkspaceError(400, 'NOT_ENTITLED', 'A feature must be entitled before it is enabled')
  return withPlatformWorkspaceAdmin(actorId, async tx => {
    const workspace = await tx.workspace.findFirst({ where: { id: workspaceId, kind: 'ORGANIZATION' } })
    if (!workspace) throw new WorkspaceError(404, 'WORKSPACE_NOT_FOUND', 'Organization workspace not found')
    const row = await tx.workspaceFeature.upsert({ where: { workspaceId_feature: { workspaceId, feature: featureId } },
      create: { workspaceId, feature: featureId, ...body }, update: body })
    await audit(tx, workspaceId, actorId, 'workspace_entitlement_updated', featureId, body)
    return { feature: row.feature, entitled: row.entitled, enabled: row.enabled, memberDefault: row.memberDefault }
  })
}

async function lockedMember(tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>, memberId: string) {
  requireWorkspaceManager(scope)
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${scope.workspace.id} FOR UPDATE`
  const fresh = await establishWorkspace(tx, scope.member.userId, scope.workspace.slug)
  requireWorkspaceManager(fresh)
  scope.member = fresh.member
  scope.workspace = fresh.workspace
  const target = await tx.workspaceMember.findFirst({ where: { id: memberId, workspaceId: scope.workspace.id } })
  if (!target) throw new WorkspaceError(404, 'MEMBER_NOT_FOUND', 'Workspace member not found')
  if (scope.member.role !== 'OWNER' && target.role !== 'LEARNER') {
    throw new WorkspaceError(403, 'OWNER_REQUIRED', 'Only an Owner may manage other workspace administrators')
  }
  return target
}

export async function changeWorkspaceMember(tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>, memberId: string, input: unknown) {
  const body = updateMemberSchema.parse(input)
  const target = await lockedMember(tx, scope, memberId)
  if (body.role && body.role !== 'LEARNER' && scope.member.role !== 'OWNER') throw new WorkspaceError(403, 'OWNER_REQUIRED', 'Only an Owner may grant administrator access')
  if (body.state === 'ACTIVE' && target.state === 'INVITED') throw new WorkspaceError(409, 'MEMBER_ACCEPTANCE_REQUIRED', 'The member must accept their invitation themselves')
  if (target.role === 'OWNER' && target.state === 'ACTIVE' && (body.role && body.role !== 'OWNER' || body.state === 'SUSPENDED')) {
    if (await tx.workspaceMember.count({ where: { workspaceId: scope.workspace.id, role: 'OWNER', state: 'ACTIVE' } }) <= 1) {
      throw new WorkspaceError(409, 'LAST_OWNER', 'Keep at least one active workspace Owner')
    }
  }
  if (target.state === 'SUSPENDED' && body.state === 'ACTIVE') {
    if (await reservedWorkspaceSeats(tx, scope.workspace.id) >= scope.workspace.maxMembers) {
      throw new WorkspaceError(409, 'SEAT_LIMIT', 'This workspace has no available seats')
    }
    if (!target.acceptedAt) throw new WorkspaceError(409, 'MEMBER_ACCEPTANCE_REQUIRED', 'An unaccepted invitation cannot be activated by an administrator')
  }
  const row = await tx.workspaceMember.update({ where: { id: target.id }, data: body })
  await audit(tx, scope.workspace.id, scope.member.userId, 'membership_updated', target.id, body)
  return { id: row.id, role: row.role, state: row.state }
}

export async function configureMemberFeature(tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>, memberId: string, feature: string, input: unknown) {
  const body = z.object({ allowed: z.boolean().nullable() }).strict().parse(input)
  await lockedMember(tx, scope, memberId)
  const featureId = featureSchema.parse(feature)
  const policy = await tx.workspaceFeature.findUnique({ where: { workspaceId_feature: { workspaceId: scope.workspace.id, feature: featureId } } })
  if (!policy || (body.allowed && !policy.entitled)) throw new WorkspaceError(403, 'NOT_ENTITLED', 'This feature has not been granted to the workspace')
  const key = { workspaceId: scope.workspace.id, memberId, feature: featureId }
  if (body.allowed === null) await tx.workspaceMemberFeature.deleteMany({ where: key })
  else await tx.workspaceMemberFeature.upsert({ where: { workspaceId_memberId_feature: key }, create: { ...key, allowed: body.allowed }, update: { allowed: body.allowed } })
  await audit(tx, scope.workspace.id, scope.member.userId, 'member_feature_updated', memberId, { feature: featureId, allowed: body.allowed })
  return { memberId, feature: featureId, allowed: body.allowed }
}

export async function updateWorkspaceBranding(tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>, input: unknown) {
  requireWorkspaceManager(scope)
  const body = brandingSchema.parse(input)
  const workspace = await tx.workspace.update({ where: { id: scope.workspace.id }, data: body })
  await audit(tx, workspace.id, scope.member.userId, 'branding_updated', undefined, { fields: Object.keys(body) })
  return presentWorkspace(workspace)
}

/** Existing-account enrollment only. Email delivery will reuse the invitation service. */
export async function addExistingMember(tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>, input: unknown) {
  const body = z.object({ email: z.string().trim().toLowerCase().email().max(254), role: z.enum(['OWNER', 'ADMIN', 'LEARNER']) }).strict().parse(input)
  requireWorkspaceManager(scope)
  if (body.role !== 'LEARNER' && scope.member.role !== 'OWNER') throw new WorkspaceError(403, 'OWNER_REQUIRED', 'Only an Owner may add administrators')
  const seats = await reservedWorkspaceSeats(tx, scope.workspace.id)
  if (seats >= scope.workspace.maxMembers) throw new WorkspaceError(409, 'SEAT_LIMIT', 'This workspace has no available seats')
  const user = await tx.user.findFirst({ where: { email: { equals: body.email, mode: 'insensitive' }, emailVerified: true }, select: { id: true } })
  if (!user) throw new WorkspaceError(409, 'VERIFIED_ACCOUNT_REQUIRED', 'This address needs a verified SpashtAI account first. Email invitations are not connected yet.')
  const member = await tx.workspaceMember.create({ data: { workspaceId: scope.workspace.id, userId: user.id, role: body.role, state: 'INVITED' } })
  await audit(tx, scope.workspace.id, scope.member.userId, 'membership_proposed', member.id, { role: body.role, emailSent: false })
  return { id: member.id, role: member.role, state: member.state, emailSent: false }
}
