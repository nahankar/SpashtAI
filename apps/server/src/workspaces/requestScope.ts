import type { NextFunction, Request, Response } from 'express'
import { currentDataScope, runWithDataScope, type DataScope } from '../lib/dataScope'
import { verifyAgentScopeToken, verifyToken, verifyWorkspaceMediaToken, verifyWorkspaceToken, type WorkspaceTokenPayload } from '../lib/jwt'
import { isValidInternalAgentRequest } from '../middleware/auth'
import { WorkspaceError, workspacesEnabled } from './contracts'
import { establishWorkspace, withWorkspaceActor, type WorkspaceTx } from './context'
import { assertWorkspaceDatabaseSafety } from './databaseSafety'
import { featureMap, memberFeatureDecisions, type WorkspaceFeatureId } from './productAccess'

/** Organization product requests carry the short-lived workspace token here; Authorization stays the identity token. */
export const WORKSPACE_HEADER = 'x-spasht-workspace'
/** `<audio src>` playback of organization media carries a session-bound ticket in this query parameter. */
export const WORKSPACE_MEDIA_PARAM = 'workspace_media'
const MEDIA_ROUTE = /^\/sessions\/([^/]+)\/recording\/stream$/
/** Agent callbacks for organization sessions echo the room's signed scope here. */
export const AGENT_SCOPE_HEADER = 'x-spasht-workspace-scope'

declare global {
  namespace Express {
    interface Request {
      dataScope?: DataScope
    }
  }
}

async function buildScope(tx: WorkspaceTx, input: { userId: string; workspaceId: string; membershipId?: string }, origin: DataScope['origin']) {
  const workspace = await tx.workspace.findUnique({ where: { id: input.workspaceId } })
  if (!workspace || workspace.kind !== 'ORGANIZATION') throw new WorkspaceError(404, 'WORKSPACE_NOT_FOUND', 'This workspace is not available to your account')
  const { member } = await establishWorkspace(tx, input.userId, workspace.slug)
  if (member.state !== 'ACTIVE' || (input.membershipId && member.id !== input.membershipId)) {
    throw new WorkspaceError(403, 'MEMBERSHIP_INACTIVE', 'Your workspace membership is no longer active')
  }
  const decisions = await memberFeatureDecisions(tx, workspace, member)
  return {
    actorId: input.userId, workspaceId: workspace.id, membershipId: member.id, role: member.role,
    slug: workspace.slug, timeZone: workspace.timeZone, features: featureMap(decisions), origin,
  } satisfies DataScope
}

/** Current membership, active workspace and supported placement, rechecked for every request/job. */
export function resolveDataScope(input: { userId: string; workspaceId: string; membershipId?: string }, origin: DataScope['origin']) {
  return withWorkspaceActor(input.userId, tx => buildScope(tx, input, origin))
}

export function resolveRequestScope(claims: WorkspaceTokenPayload) {
  return resolveDataScope(claims, 'request')
}

function bearer(req: Request) {
  const header = req.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice(7) : ''
}

function headerValue(req: Request, name: string) {
  const value = req.headers[name]
  return (Array.isArray(value) ? value[0] : value)?.trim() || ''
}

function fail(res: Response, error: unknown) {
  if (error instanceof WorkspaceError) {
    res.status(error.status).json({ error: error.message, code: error.code })
    return
  }
  res.status(401).json({ error: 'Open the workspace again to continue', code: 'WORKSPACE_TOKEN_REQUIRED' })
}

const CONTROL_PLANE = [/^\/api\/workspaces(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/invitations(\/|$)/]

/**
 * Binds an organization scope for product routes. A request that asks for a
 * workspace and cannot be verified fails; it is never served as Personal.
 */
export async function bindWorkspaceRequest(req: Request, res: Response, next: NextFunction) {
  const agentScope = headerValue(req, AGENT_SCOPE_HEADER)
  if (agentScope) return bindAgentRequest(req, res, next, agentScope)
  const media = req.query[WORKSPACE_MEDIA_PARAM]
  if (media !== undefined) return bindMediaRequest(req, res, next, media)
  const raw = headerValue(req, WORKSPACE_HEADER)
  if (!raw) return next()
  const path = req.path
  if (CONTROL_PLANE.some(pattern => pattern.test(path))) return next()
  if (/^\/api\/admin(\/|$)/.test(path) || /^\/internal(\/|$)/.test(path)) {
    res.status(403).json({ error: 'Platform administration does not accept a workspace context', code: 'WORKSPACE_CONTEXT_REJECTED' })
    return
  }
  try {
    if (!workspacesEnabled()) throw new WorkspaceError(404, 'WORKSPACES_DISABLED', 'Workspaces are not available yet')
    await assertWorkspaceDatabaseSafety()
    const claims = verifyWorkspaceToken(raw)
    let identity
    try { identity = verifyToken(bearer(req)) } catch { throw new WorkspaceError(401, 'IDENTITY_REQUIRED', 'Sign in again to continue') }
    if (identity.userId !== claims.userId) throw new WorkspaceError(403, 'WORKSPACE_IDENTITY_MISMATCH', 'Open the workspace again to continue')
    const scope = await resolveRequestScope(claims)
    req.dataScope = scope
    runWithDataScope(scope, next)
  } catch (error) {
    fail(res, error)
  }
}

async function bindMediaRequest(req: Request, res: Response, next: NextFunction, ticket: unknown) {
  try {
    const sessionId = MEDIA_ROUTE.exec(req.path)?.[1]
    if (req.method !== 'GET' || !sessionId || typeof ticket !== 'string' || headerValue(req, WORKSPACE_HEADER)) {
      throw new WorkspaceError(400, 'WORKSPACE_MEDIA_REJECTED', 'This playback link is not valid here')
    }
    if (!workspacesEnabled()) throw new WorkspaceError(404, 'WORKSPACES_DISABLED', 'Workspaces are not available yet')
    await assertWorkspaceDatabaseSafety()
    let claims
    try { claims = verifyWorkspaceMediaToken(ticket) } catch { throw new WorkspaceError(401, 'WORKSPACE_TOKEN_REQUIRED', 'Open the workspace again to continue') }
    if (decodeURIComponent(sessionId) !== claims.sessionId) throw new WorkspaceError(403, 'WORKSPACE_MEDIA_REJECTED', 'This playback link is not valid here')
    const access = typeof req.query.access_token === 'string' ? req.query.access_token : bearer(req)
    let identity
    try { identity = verifyToken(access) } catch { throw new WorkspaceError(401, 'IDENTITY_REQUIRED', 'Sign in again to continue') }
    if (identity.userId !== claims.userId) throw new WorkspaceError(403, 'WORKSPACE_IDENTITY_MISMATCH', 'Open the workspace again to continue')
    const scope = await resolveDataScope(claims, 'request')
    req.dataScope = scope
    runWithDataScope(scope, next)
  } catch (error) {
    fail(res, error)
  }
}

async function bindAgentRequest(req: Request, res: Response, next: NextFunction, token: string) {
  try {
    if (!isValidInternalAgentRequest(req)) throw new WorkspaceError(401, 'AGENT_REQUIRED', 'Internal agent authentication is required')
    if (!workspacesEnabled()) throw new WorkspaceError(404, 'WORKSPACES_DISABLED', 'Workspaces are not available yet')
    await assertWorkspaceDatabaseSafety()
    let claims
    try { claims = verifyAgentScopeToken(token) } catch { throw new WorkspaceError(401, 'AGENT_SCOPE_INVALID', 'The voice session scope is invalid') }
    const pathSession = /\/sessions\/([^/?]+)/.exec(req.path)?.[1]
    if (pathSession && decodeURIComponent(pathSession) !== claims.sessionId) {
      throw new WorkspaceError(403, 'AGENT_SCOPE_MISMATCH', 'The voice session scope does not match this activity')
    }
    const scope = await resolveDataScope(claims, 'agent')
    req.dataScope = scope
    runWithDataScope(scope, next)
  } catch (error) {
    fail(res, error)
  }
}

/** Middleware that run in a lost async context (for example multipart parsers) must re-enter the scope. */
export function reenterDataScope(req: Request, _res: Response, next: NextFunction) {
  if (req.dataScope && currentDataScope()?.workspaceId !== req.dataScope.workspaceId) return runWithDataScope(req.dataScope, next)
  next()
}

export function scopeAllows(feature: WorkspaceFeatureId, scope = currentDataScope()) {
  return Boolean(scope?.features[feature])
}

export function requireWorkspaceFeature(feature: WorkspaceFeatureId, scope = currentDataScope()) {
  if (!scope) return
  if (!scope.features[feature]) {
    throw new WorkspaceError(403, 'WORKSPACE_FEATURE_UNAVAILABLE', 'This feature is not available in this workspace')
  }
}

/**
 * Background work for one organization learner. Returns null without running when
 * the membership or workspace is no longer active.
 */
export async function withJobScope<T>(workspaceId: string, userId: string, work: () => Promise<T>): Promise<T | null> {
  let scope: DataScope
  try {
    scope = await resolveDataScope({ userId, workspaceId }, 'job')
  } catch (error) {
    if (error instanceof WorkspaceError) return null
    throw error
  }
  return runWithDataScope(scope, work)
}

/** Destroys tombstoned organization activity even after the learner's membership ended. */
export function withCleanupScope<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
  return runWithDataScope({
    actorId: 'system:cleanup', workspaceId, membershipId: 'system:cleanup', role: 'LEARNER', slug: '', timeZone: 'UTC',
    features: {}, reader: 'cleanup', origin: 'job',
  }, work)
}
