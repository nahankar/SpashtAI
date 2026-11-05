import { withPlatformWorkspaceAdmin } from './context'
import { WorkspaceError } from './contracts'
import { sendEmail } from '../lib/email'
import { invitationDeliveryMode } from '../lib/invitations'
import { logger } from '../lib/logger'
import { reserveInvitationSend } from '../lib/invitationBatch'

export function buildOwnerAccessEmail(workspace: { name: string; slug: string }, baseUrl: string) {
  const url = `${baseUrl.replace(/\/$/, '')}/w/${encodeURIComponent(workspace.slug)}`
  return { subject: `Your ${workspace.name.replace(/[\r\n]/g, ' ')} workspace Owner access on SpashtAI`, text: [
    `You have been assigned Owner access to ${workspace.name} on SpashtAI.`, '',
    `Open your workspace: ${url}`, '',
    'Sign in with a code emailed to this address or with Google. There is no separate workspace password.',
    'If your membership is pending, select Accept invitation on the workspace page.',
    'As Owner you can invite learners and workspace administrators, manage memberships, and configure workspace signup fields and invitation messages.',
    'After acceptance, this email has organization access only. Previous Personal history is preserved but unavailable. Use another email for Personal access. Workspace analytics are available to Owners and Admins; practice products appear as they become available for your organization.', '',
    'If this was unexpected, contact the administrator who assigned your access.', '',
    'Replies to this mailbox are not routinely monitored and may not receive a response.',
  ].join('\n') }
}
export async function sendOwnerAccess(actorId: string, workspaceId: string, membershipId: string) {
  const target = await withPlatformWorkspaceAdmin(actorId, async tx => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${workspaceId} FOR UPDATE`
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId } })
    if (!workspace || workspace.kind !== 'ORGANIZATION' || workspace.state !== 'ACTIVE' || workspace.storageMode !== 'SHARED' || workspace.databaseKey !== 'primary') throw new WorkspaceError(403, 'WORKSPACE_UNAVAILABLE', 'This workspace is unavailable')
    const owner = await tx.workspaceMember.findFirst({ where: { id: membershipId, workspaceId, role: 'OWNER', state: { in: ['INVITED', 'ACTIVE'] } }, include: { user: { select: { email: true, emailVerified: true } } } })
    if (!owner || !owner.user.emailVerified) throw new WorkspaceError(404, 'OWNER_UNAVAILABLE', 'An active or pending Owner with a verified account is required')
    reserveInvitationSend(actorId)
    await tx.workspaceAudit.create({ data: { workspaceId, actorUserId: actorId, action: 'owner_access_email_requested', subjectId: owner.id } })
    return { workspace, email: owner.user.email }
  })
  const base = process.env.FRONTEND_URL?.trim()
  let deliveryStatus = 'NOT_SENT'
  if (invitationDeliveryMode() !== 'smtp') deliveryStatus = 'PREVIEW_ONLY'
  else if (base) {
    const email = buildOwnerAccessEmail(target.workspace, base)
    // Plain text stays plain in both MIME parts. Never turn administrator text into HTML.
    const html = `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${email.text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)}</pre>`
    try {
      const result = await sendEmail({ to: target.email, ...email, html, logBody: false })
      deliveryStatus = result.sent ? 'SENT' : 'NOT_SENT'
    } catch { deliveryStatus = 'NOT_SENT' }
  }
  try {
    await withPlatformWorkspaceAdmin(actorId, tx => tx.workspaceAudit.create({ data: { workspaceId, actorUserId: actorId, action: 'owner_access_email_result', subjectId: membershipId, metadata: { deliveryStatus } } }))
  } catch {
    // A completed SMTP attempt must not be misreported as failed just because its audit write failed.
    logger.error({ event: 'workspace.owner_email_audit_failed', workspaceId, membershipId, deliveryStatus }, 'Owner access email audit could not be recorded')
  }
  return { deliveryStatus }
}
