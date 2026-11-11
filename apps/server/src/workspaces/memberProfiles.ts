import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import type { WorkspaceTokenPayload } from '../lib/jwt'
import { attachSignupLocation, validateProfileFields } from '../lib/profile'
import { enrollmentFieldsSchema, readEnrollmentSettings, validateEnrollmentResponses } from './enrollment'
import { WorkspaceError } from './contracts'
import { requireWorkspaceManager, withLockedWorkspaceAccess, withWorkspaceAccess, type WorkspaceTx, type establishWorkspace } from './context'

type Scope = Awaited<ReturnType<typeof establishWorkspace>>
const profileSelect = { id: true, email: true, firstName: true, lastName: true, phone: true, dateOfBirth: true, gender: true,
  pincode: true, city: true, state: true, country: true } as const
const inputSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/), firstName: z.string().trim().min(1).max(120), lastName: z.string().trim().max(120),
  phone: z.string().max(30), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), gender: z.enum(['MALE', 'FEMALE']), pincode: z.string().max(20),
  enrollmentResponses: z.record(z.union([z.string().max(1000), z.array(z.string().max(120)).max(30)])),
}).strict()
async function readProfile(tx: WorkspaceTx, scope: Scope, memberId: string) {
  requireWorkspaceManager(scope)
  const member = await tx.workspaceMember.findFirst({ where: { id: memberId, workspaceId: scope.workspace.id } })
  if (!member) throw new WorkspaceError(404, 'MEMBER_NOT_FOUND', 'Workspace member not found')
  const user = await tx.user.findUniqueOrThrow({ where: { id: member.userId }, select: profileSelect })
  // Preserve this user’s signup form; refresh definitions for existing fields and retain historical-only fields.
  const current = readEnrollmentSettings(scope.workspace.enrollmentSettings).fields
  const stored = enrollmentFieldsSchema.parse(member.enrollmentFields)
  const fields = stored.length ? stored.map(f => current.find(c => c.id === f.id) ?? f) : current
  const profile = { ...user, dateOfBirth: user.dateOfBirth?.toISOString().slice(0, 10) ?? null }
  const data = { profile, enrollmentFields: fields, enrollmentResponses: member.enrollmentResponses }
  const revision = createHash('sha256').update(JSON.stringify(data)).digest('hex')
  return { ...data, revision }
}
export function getWorkspaceMemberProfile(claims: WorkspaceTokenPayload, memberId: string) {
  return withWorkspaceAccess(claims, (tx, scope) => readProfile(tx, scope, memberId))
}
export async function updateWorkspaceMemberProfile(claims: WorkspaceTokenPayload, memberId: string, input: unknown) {
  const body = inputSchema.parse(input)
  const validated = validateProfileFields(body)
  const date = new Date(body.dateOfBirth)
  if (!validated.data || validated.error || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== body.dateOfBirth || date > new Date()) {
    throw new WorkspaceError(400, 'INVALID_PROFILE', validated.error || 'Enter a valid date of birth that is not in the future')
  }
  const before = await getWorkspaceMemberProfile(claims, memberId)
  // Do not hold database locks while looking up a changed postal code.
  const location = before.profile.pincode === validated.data.pincode
    ? { ...validated.data, city: before.profile.city, state: before.profile.state, country: before.profile.country }
    : await attachSignupLocation(validated.data, before.profile)
  return withLockedWorkspaceAccess(claims, async (tx, scope) => {
    requireWorkspaceManager(scope)
    const target = await tx.workspaceMember.findFirst({ where: { id: memberId, workspaceId: scope.workspace.id } })
    if (!target) throw new WorkspaceError(404, 'MEMBER_NOT_FOUND', 'Workspace member not found')
    // Basic fields belong to the shared account. Serialize edits from different workspaces as well.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${target.userId} FOR UPDATE`
    const current = await readProfile(tx, scope, memberId)
    if (current.revision !== body.revision) throw new WorkspaceError(409, 'PROFILE_CHANGED', 'This profile or its signup fields changed. Close and reopen Profile before saving again.')
    const responses = validateEnrollmentResponses(current.enrollmentFields, body.enrollmentResponses)
    await tx.user.update({ where: { id: target.userId }, data: { firstName: body.firstName, lastName: body.lastName || null, ...location } })
    await tx.workspaceMember.update({ where: { id: target.id }, data: { enrollmentResponses: responses, enrollmentFields: current.enrollmentFields as Prisma.InputJsonArray } })
    await tx.workspaceAudit.create({ data: { workspaceId: scope.workspace.id, actorUserId: scope.member.userId,
      action: 'member_profile_updated', subjectId: target.id, metadata: { userId: target.userId,
        fields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'pincode'], enrollmentFieldIds: Object.keys(responses) } } })
    return readProfile(tx, scope, memberId)
  })
}
