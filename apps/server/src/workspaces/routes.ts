import { Router, type Request, type Response, type NextFunction } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { verifyWorkspaceToken } from '../lib/jwt'
import { idSchema, WorkspaceError, workspacesEnabled } from './contracts'
import { withWorkspaceAccess } from './context'
import * as service from './service'

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
    const roles = await prisma.$queryRaw<Array<{ bypass: boolean }>>`SELECT (rolsuper OR rolbypassrls OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('Workspace','WorkspaceMember','WorkspaceFeature','WorkspaceMemberFeature','WorkspaceAudit') AND pg_has_role(current_user,c.relowner,'MEMBER'))) AS bypass FROM pg_roles WHERE rolname=current_user`
    if (roles[0]?.bypass !== false) throw new WorkspaceError(503, 'WORKSPACE_DATABASE_ROLE_UNSAFE', 'Workspaces require a non-owner database role that enforces row isolation')
    const tables = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('Workspace','WorkspaceMember','WorkspaceFeature','WorkspaceMemberFeature','WorkspaceAudit') AND c.relrowsecurity AND c.relforcerowsecurity`
    if (Number(tables[0]?.count) !== 5) throw new WorkspaceError(503, 'WORKSPACE_POLICIES_UNAVAILABLE', 'Workspace row isolation is not installed')
    next()
  } catch (error) { next(error) }
}

workspaceRouter.get('/config', (_req, res) => res.json({ enabled: workspacesEnabled() }))
workspaceRouter.use(gate)
platformWorkspacesRouter.use(gate, requireAuth)
// These routes only accept an identity token. Organization tokens cannot escape
// through the pre-existing Personal or platform Admin middleware.
workspaceRouter.get('/', requireAuth, route(req => service.listMyWorkspaces(req.user!.userId)))
workspaceRouter.post('/entry/:slug', requireAuth, route(req => service.enterWorkspace(req.user!.userId, idSchema.parse(req.params.slug))))
workspaceRouter.post('/entry/:slug/accept', requireAuth, route(req => service.acceptWorkspaceMembership(req.user!.userId, idSchema.parse(req.params.slug))))

function scoped(handler: (tx: Parameters<Parameters<typeof withWorkspaceAccess>[1]>[0], scope: Parameters<Parameters<typeof withWorkspaceAccess>[1]>[1], req: Request) => Promise<unknown>) {
  return route(async req => {
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
    let claims
    try { claims = verifyWorkspaceToken(token) } catch { throw new WorkspaceError(401, 'WORKSPACE_TOKEN_REQUIRED', 'Open the workspace again to continue') }
    return withWorkspaceAccess(claims, (tx, scope) => handler(tx, scope, req))
  })
}
workspaceRouter.get('/current', scoped((tx, scope) => service.workspaceSnapshot(tx, scope)))
workspaceRouter.get('/current/members', scoped((tx, scope) => service.listWorkspaceMembers(tx, scope)))
workspaceRouter.post('/current/members', scoped((tx, scope, req) => service.addExistingMember(tx, scope, req.body)))
workspaceRouter.patch('/current/branding', scoped((tx, scope, req) => service.updateWorkspaceBranding(tx, scope, req.body)))
workspaceRouter.put('/current/features/:feature', scoped((tx, scope, req) => service.configureWorkspaceFeature(tx, scope, String(req.params.feature), req.body)))
workspaceRouter.patch('/current/members/:memberId', scoped((tx, scope, req) => service.changeWorkspaceMember(tx, scope, idSchema.parse(req.params.memberId), req.body)))
workspaceRouter.put('/current/members/:memberId/features/:feature', scoped((tx, scope, req) => service.configureMemberFeature(tx, scope, idSchema.parse(req.params.memberId), String(req.params.feature), req.body)))
platformWorkspacesRouter.get('/', route(req => service.listPlatformWorkspaces(req.user!.userId)))
platformWorkspacesRouter.post('/', route(req => service.createOrganization(req.user!.userId, req.body)))
platformWorkspacesRouter.patch('/:workspaceId', route(req => service.updatePlatformWorkspace(req.user!.userId, idSchema.parse(req.params.workspaceId), req.body)))
platformWorkspacesRouter.put('/:workspaceId/features/:feature', route(req => service.configurePlatformFeature(req.user!.userId, idSchema.parse(req.params.workspaceId), String(req.params.feature), req.body)))

export function workspaceErrorHandler(error: unknown, _req: Request, res: Response, next: NextFunction) {
  if (error instanceof WorkspaceError) { res.status(error.status).json({ error: error.message, code: error.code }); return }
  if (error instanceof ZodError) { res.status(400).json({ error: 'Invalid workspace settings', code: 'INVALID_INPUT', issues: error.issues.map(i => ({ path: i.path, message: i.message })) }); return }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({ error: 'That workspace address or membership already exists', code: 'WORKSPACE_CONFLICT' }); return
  }
  next(error)
}
workspaceRouter.use(workspaceErrorHandler)
platformWorkspacesRouter.use(workspaceErrorHandler)
