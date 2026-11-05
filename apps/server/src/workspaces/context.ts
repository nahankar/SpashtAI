import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { WorkspaceTokenPayload } from '../lib/jwt'
import { WorkspaceError } from './contracts'

export type WorkspaceTx = Prisma.TransactionClient

async function actorContext(tx: WorkspaceTx, actorId: string) {
  await tx.$queryRaw`SELECT set_config('app.workspace_actor_id', ${actorId}, true),
    set_config('app.workspace_id', '', true), set_config('app.workspace_platform_admin', 'false', true)`
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, emailVerified: true } })
  if (!actor) throw new WorkspaceError(401, 'IDENTITY_UNAVAILABLE', 'Sign in again to continue')
  return actor
}

/** All context is LOCAL to this transaction, including resets on a reused pooled connection. */
export function withWorkspaceActor<T>(actorId: string, work: (tx: WorkspaceTx) => Promise<T>) {
  return prisma.$transaction(async tx => { await actorContext(tx, actorId); return work(tx) })
}

export function withPlatformWorkspaceAdmin<T>(actorId: string, work: (tx: WorkspaceTx) => Promise<T>) {
  return prisma.$transaction(async tx => {
    const actor = await actorContext(tx, actorId)
    if (actor.role !== 'ADMIN' && actor.role !== 'SUPER_ADMIN') {
      throw new WorkspaceError(403, 'PLATFORM_ADMIN_REQUIRED', 'Platform administrator access is required')
    }
    // Do not trust the login-time JWT role or a client-supplied platform flag.
    await tx.$queryRaw`SELECT set_config('app.workspace_platform_admin', 'true', true)`
    return work(tx)
  })
}

export async function establishWorkspace(tx: WorkspaceTx, actorId: string, slug: string) {
  const workspace = await tx.workspace.findUnique({ where: { slug } })
  if (!workspace) throw new WorkspaceError(404, 'WORKSPACE_NOT_FOUND', 'This workspace is not available to your account')
  if (workspace.kind === 'PERSONAL') {
    const user = await tx.user.findUnique({ where: { id: actorId }, select: { tenantOnly: true } })
    if (user?.tenantOnly) throw new WorkspaceError(403, 'TENANT_ONLY_ACCOUNT', 'This email has organization access only. Use a different email for Personal access.')
  }
  const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: actorId } } })
  if (!member || member.state === 'SUSPENDED') throw new WorkspaceError(404, 'WORKSPACE_NOT_FOUND', 'This workspace is not available to your account')
  if (workspace.state !== 'ACTIVE') throw new WorkspaceError(403, 'WORKSPACE_SUSPENDED', 'This workspace has been suspended')
  if (workspace.storageMode !== 'SHARED' || workspace.databaseKey !== 'primary') {
    throw new WorkspaceError(503, 'WORKSPACE_PLACEMENT_UNAVAILABLE', 'This workspace is not available yet')
  }
  await tx.$queryRaw`SELECT set_config('app.workspace_id', ${workspace.id}, true)`
  return { workspace, member }
}

export function withWorkspaceAccess<T>(
  claims: WorkspaceTokenPayload,
  work: (tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>) => Promise<T>,
  options: { lockWorkspace?: boolean } = {},
) {
  return withWorkspaceActor(claims.userId, async tx => {
    // Membership id prevents an old token from surviving deletion and re-enrollment.
    const membership = await tx.workspaceMember.findUnique({ where: { id: claims.membershipId } })
    if (!membership || membership.userId !== claims.userId || membership.workspaceId !== claims.workspaceId || membership.state !== 'ACTIVE') {
      throw new WorkspaceError(403, 'MEMBERSHIP_INACTIVE', 'Your workspace membership is no longer active')
    }
    const workspace = await tx.workspace.findUnique({ where: { id: claims.workspaceId } })
    if (!workspace) throw new WorkspaceError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found')
    // Context must precede SELECT FOR UPDATE: UPDATE RLS otherwise filters out
    // the row without taking a lock. Recheck membership after waiting.
    await establishWorkspace(tx, claims.userId, workspace.slug)
    if (options.lockWorkspace) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Workspace" WHERE id=${workspace.id} FOR UPDATE`
      if (locked.length !== 1) throw new WorkspaceError(403, 'MEMBERSHIP_INACTIVE', 'Your workspace membership is no longer active')
    }
    const scope = await establishWorkspace(tx, claims.userId, workspace.slug)
    if (scope.member.id !== claims.membershipId || scope.member.state !== 'ACTIVE') throw new WorkspaceError(403, 'MEMBERSHIP_INACTIVE', 'Your workspace membership is no longer active')
    return work(tx, scope)
  })
}

/** Membership, seat and invitation mutations serialize on the Workspace row. */
export function withLockedWorkspaceAccess<T>(
  claims: WorkspaceTokenPayload,
  work: (tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>) => Promise<T>,
) {
  return withWorkspaceAccess(claims, work, { lockWorkspace: true })
}

export function requireWorkspaceManager(scope: Awaited<ReturnType<typeof establishWorkspace>>, ownerOnly = false) {
  if (scope.workspace.kind !== 'ORGANIZATION' || scope.member.state !== 'ACTIVE'
    || (ownerOnly ? scope.member.role !== 'OWNER' : !['OWNER', 'ADMIN'].includes(scope.member.role))) {
    throw new WorkspaceError(403, 'WORKSPACE_ADMIN_REQUIRED', ownerOnly ? 'Workspace Owner access is required' : 'Workspace administrator access is required')
  }
}
