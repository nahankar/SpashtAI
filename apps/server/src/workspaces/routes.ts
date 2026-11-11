import { accessPolicySchema, policyData } from '../lib/signInPolicy'
import { getWorkspaceMemberProfile, updateWorkspaceMemberProfile } from './memberProfiles'
import { invitationPreview } from './invitationPreview'
import { sendOwnerAccess } from './ownerAccess'
import * as invitations from './invitations'
import { saveManagedEnrollment, saveEnrollmentSettings } from './enrollment'
import { withPlatformWorkspaceAdmin } from './context'
import { workspaceAnalyticsLimiter } from '../middleware/rate-limit'
import { archiveSessionDetail, archiveSessionTranscript, listArchiveSessions } from './sessionArchive'
import { streamWorkspaceRecording } from './sessionMedia'
import { Router, type Request, type Response, type NextFunction } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { assertWorkspaceDatabaseSafety } from './databaseSafety'
import { verifyWorkspaceToken } from '../lib/jwt'
import { idSchema, WorkspaceError, workspacesEnabled } from './contracts'
import { withWorkspaceAccess, requireWorkspaceManager } from './context'
import * as service from './service'
import * as analytics from './analytics'
import * as plans from './analyticsPlans'
import { workspaceFieldFilters } from './fieldFilters'
import { workspaceExport, type ExportReport } from './exports'

export const workspaceRouter = Router()
export const platformWorkspacesRouter = Router()
type Handler = (req: Request) => Promise<unknown>
function route(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try { res.json(await handler(req)) } catch (error) { next(error) }
  }
}

/** Rechecked on every workspace request, including when migrations/role change. */
async function gate(_req: Request, _res: Response, next: NextFunction) {
  if (!workspacesEnabled()) return next(new WorkspaceError(404, 'WORKSPACES_DISABLED', 'Workspaces are not available yet'))
  try {
    await assertWorkspaceDatabaseSafety()
    next()
  } catch (error) { next(error) }
}

workspaceRouter.get('/config', (_req, res) => res.json({ enabled: workspacesEnabled() }))
workspaceRouter.use(gate)
platformWorkspacesRouter.use(gate, requireAuth)
// These routes only accept an identity token. Organization tokens cannot escape
// through the pre-existing Personal or platform Admin middleware.
workspaceRouter.get('/', requireAuth, route(req => service.listMyWorkspaces(req.user!.userId)))
workspaceRouter.post('/entry/:slug', requireAuth, route(req => service.enterWorkspace(req.user!.userId, idSchema.parse(req.params.slug), req.user!.authMethod)))
workspaceRouter.post('/entry/:slug/accept', requireAuth, route(req => service.acceptWorkspaceMembership(req.user!.userId, idSchema.parse(req.params.slug), req.user!.authMethod)))

function workspaceClaims(req: Request) {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
  try { return verifyWorkspaceToken(token) } catch { throw new WorkspaceError(401, 'WORKSPACE_TOKEN_REQUIRED', 'Open the workspace again to continue') }
}
function scoped(
  handler: (tx: Parameters<Parameters<typeof withWorkspaceAccess>[1]>[0], scope: Parameters<Parameters<typeof withWorkspaceAccess>[1]>[1], req: Request) => Promise<unknown>,
  options: { lockWorkspace?: boolean } = {},
) {
  return route(async req => {
    const claims = workspaceClaims(req)
    return withWorkspaceAccess(claims, (tx, scope) => handler(tx, scope, req), options)
  })
}
function scopedWrite(
  handler: (tx: Parameters<Parameters<typeof withWorkspaceAccess>[1]>[0], scope: Parameters<Parameters<typeof withWorkspaceAccess>[1]>[1], req: Request) => Promise<unknown>,
) {
  return scoped(handler, { lockWorkspace: true })
}
workspaceRouter.post('/current/invitations/preview', scoped(async (_tx, scope, req) => {
  requireWorkspaceManager(scope)
  return invitationPreview(scope.workspace.name, req.body)
}))
workspaceRouter.put('/current/access-policy', scopedWrite(async (tx, scope, req) => {
  requireWorkspaceManager(scope)
  const policy = accessPolicySchema.parse(req.body)
  await tx.workspace.update({ where: { id: scope.workspace.id }, data: policyData(policy) })
  await tx.workspaceAudit.create({ data: { workspaceId: scope.workspace.id, actorUserId: scope.member.userId, action: 'access_policy_updated', metadata: policy } })
  return { accessPolicy: policy }
}))
workspaceRouter.put('/current/enrollment', scopedWrite((tx, scope, req) => saveManagedEnrollment(tx, scope, req.body)))
workspaceRouter.post('/current/invitations/bulk', route(req => invitations.createWorkspaceInvitationBatch(workspaceClaims(req), req.body)))
workspaceRouter.get('/current/invitations', scoped((tx, scope, req) => invitations.listWorkspaceInvitations(tx, scope, req.query)))
workspaceRouter.post('/current/invitations', route(req => invitations.createWorkspaceInvitation(workspaceClaims(req), req.body)))
workspaceRouter.post('/current/invitations/:id/resend', route(req => invitations.changeWorkspaceInvitation(workspaceClaims(req), idSchema.parse(req.params.id), 'resend')))
workspaceRouter.post('/current/invitations/:id/revoke', route(req => invitations.changeWorkspaceInvitation(workspaceClaims(req), idSchema.parse(req.params.id), 'revoke')))
workspaceRouter.get('/current/sessions', scoped((tx, scope, req) => listArchiveSessions(tx, scope, req.query)))
workspaceRouter.get('/current/sessions/:sessionId', scoped((tx, scope, req) => archiveSessionDetail(tx, scope, idSchema.parse(req.params.sessionId))))
workspaceRouter.get('/current/sessions/:sessionId/transcript', scoped((tx, scope, req) => archiveSessionTranscript(tx, scope, idSchema.parse(req.params.sessionId))))
workspaceRouter.get('/current/sessions/:sessionId/recordings/:recordingId/stream', streamWorkspaceRecording)
workspaceRouter.get('/current', scoped((tx, scope) => service.workspaceSnapshot(tx, scope)))
workspaceRouter.get('/current/members', scoped((tx, scope, req) => service.listWorkspaceMembers(tx, scope, req.query)))
workspaceRouter.get('/current/admin/field-filters', scoped((_tx, scope) => Promise.resolve(workspaceFieldFilters(scope))))
for (const [path, report] of [
  ['/current/members/export.xlsx', 'users'],
  ['/current/admin/feature-usage/export.xlsx', 'feature-usage'],
  ['/current/admin/progress-pulse/export.xlsx', 'progress-pulse'],
] as const satisfies ReadonlyArray<readonly [string, ExportReport]>) {
  workspaceRouter.get(path, workspaceAnalyticsLimiter, async (req, res, next) => {
    try {
      const result = await withWorkspaceAccess(workspaceClaims(req), (tx, scope) => workspaceExport(tx, scope, report, req.query), { lockWorkspace: true })
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
      res.send(result.buffer)
    } catch (error) { next(error) }
  })
}
workspaceRouter.get('/current/admin/overview', scoped((tx, scope, req) => analytics.workspaceOverview(tx, scope, req.query)))
workspaceRouter.get('/current/admin/activity/daily', scoped((tx, scope, req) => analytics.workspaceDailyActivity(tx, scope, req.query)))
workspaceRouter.get('/current/admin/activity/learners', scoped((tx, scope, req) => analytics.workspaceLearnerActivity(tx, scope, req.query)))
workspaceRouter.get('/current/admin/feature-usage', scoped((tx, scope, req) => analytics.workspaceFeatureUsage(tx, scope, req.query)))
workspaceRouter.get('/current/admin/progress-pulse', scoped((tx, scope, req) => analytics.workspaceProgressPulse(tx, scope, req.query)))
workspaceRouter.get('/current/admin/feedback', scoped((tx, scope, req) => analytics.workspaceFeedback(tx, scope, req.query)))
workspaceRouter.post('/current/admin/analytics/interpret', workspaceAnalyticsLimiter, route(async req => {
  const claims = workspaceClaims(req)
  const bound = await withWorkspaceAccess(claims, (tx, scope) => plans.bindWorkspaceInterpret(tx, scope, req.body))
  if (bound.kind === 'early') return bound.value
  let raw: string
  try {
    raw = await plans.completeWorkspaceAnalytics(bound.prompt)
  } catch {
    throw new WorkspaceError(503, 'ANALYTICS_AI_UNAVAILABLE', 'AI Analytics is temporarily unavailable. Please retry.')
  }
  return withWorkspaceAccess(claims, (tx, scope) => plans.finishWorkspaceInterpret(tx, scope, bound, raw))
}))
workspaceRouter.post('/current/admin/analytics/run', scopedWrite((tx, scope, req) => plans.runWorkspacePlan(tx, scope, req.body)))
workspaceRouter.get('/current/admin/analytics/saved', scoped((tx, scope) => plans.listWorkspacePlans(tx, scope)))
workspaceRouter.post('/current/admin/analytics/saved/:id/run', scopedWrite((tx, scope, req) => plans.rerunWorkspacePlan(tx, scope, idSchema.parse(req.params.id))))
workspaceRouter.patch('/current/admin/analytics/saved/:id', scopedWrite((tx, scope, req) => plans.updateWorkspacePlan(tx, scope, idSchema.parse(req.params.id), req.body)))
workspaceRouter.delete('/current/admin/analytics/saved/:id', scopedWrite((tx, scope, req) => plans.deleteWorkspacePlan(tx, scope, idSchema.parse(req.params.id))))
workspaceRouter.post('/current/members', scopedWrite((tx, scope, req) => service.addExistingMember(tx, scope, req.body)))
workspaceRouter.patch('/current/branding', scopedWrite((tx, scope, req) => service.updateWorkspaceBranding(tx, scope, req.body)))
workspaceRouter.put('/current/features/:feature', scopedWrite((tx, scope, req) => service.configureWorkspaceFeature(tx, scope, String(req.params.feature), req.body)))
workspaceRouter.get('/current/members/:memberId/profile', route(req => getWorkspaceMemberProfile(workspaceClaims(req), idSchema.parse(req.params.memberId))))
workspaceRouter.patch('/current/members/:memberId/profile', route(req => updateWorkspaceMemberProfile(workspaceClaims(req), idSchema.parse(req.params.memberId), req.body)))
workspaceRouter.patch('/current/members/:memberId', scopedWrite((tx, scope, req) => service.changeWorkspaceMember(tx, scope, idSchema.parse(req.params.memberId), req.body)))
workspaceRouter.delete('/current/members/:memberId', scopedWrite((tx, scope, req) => service.deleteWorkspaceMember(tx, scope, idSchema.parse(req.params.memberId), req.body)))
workspaceRouter.put('/current/members/:memberId/features/:feature', scopedWrite((tx, scope, req) => service.configureMemberFeature(tx, scope, idSchema.parse(req.params.memberId), String(req.params.feature), req.body)))
platformWorkspacesRouter.put('/:workspaceId/enrollment', route(req => withPlatformWorkspaceAdmin(req.user!.userId, tx => saveEnrollmentSettings(tx, idSchema.parse(req.params.workspaceId), req.user!.userId, req.body))))
platformWorkspacesRouter.post('/:workspaceId/invitations/preview', route(req => withPlatformWorkspaceAdmin(req.user!.userId, async tx => {
  const workspace = await tx.workspace.findUnique({ where: { id: idSchema.parse(req.params.workspaceId), kind: 'ORGANIZATION' } })
  if (!workspace) throw new WorkspaceError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found')
  return invitationPreview(workspace.name, req.body)
})))
platformWorkspacesRouter.post('/:workspaceId/owners/:membershipId/send-access', route(req => sendOwnerAccess(req.user!.userId, idSchema.parse(req.params.workspaceId), idSchema.parse(req.params.membershipId))))
platformWorkspacesRouter.get('/', route(req => service.listPlatformWorkspaces(req.user!.userId)))
platformWorkspacesRouter.post('/', route(req => service.createOrganization(req.user!.userId, req.body)))
platformWorkspacesRouter.patch('/:workspaceId', route(req => service.updatePlatformWorkspace(req.user!.userId, idSchema.parse(req.params.workspaceId), req.body)))
platformWorkspacesRouter.put('/:workspaceId/features/:feature', route(req => service.configurePlatformFeature(req.user!.userId, idSchema.parse(req.params.workspaceId), String(req.params.feature), req.body)))

export function workspaceErrorHandler(error: unknown, _req: Request, res: Response, next: NextFunction) {
  if (error instanceof WorkspaceError) { res.status(error.status).json({ error: error.message, code: error.code, ...error.details }); return }
  if (error instanceof ZodError) { res.status(400).json({ error: 'Invalid workspace settings', code: 'INVALID_INPUT', issues: error.issues.map(i => ({ path: i.path, message: i.message })) }); return }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({ error: 'That workspace address or membership already exists', code: 'WORKSPACE_CONFLICT' }); return
  }
  next(error)
}
workspaceRouter.use(workspaceErrorHandler)
platformWorkspacesRouter.use(workspaceErrorHandler)
