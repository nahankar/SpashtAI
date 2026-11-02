import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { WorkspaceError } from './contracts'
import { requireWorkspaceManager, type WorkspaceTx, type establishWorkspace } from './context'

const text = z.string().trim().min(1).max(200)
export const enrollmentFieldSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).refine(v => !['constructor', 'prototype', '__proto__'].includes(v), 'Choose a different field identifier'),
  type: z.enum(['text', 'dropdown', 'radio', 'checkbox', 'message']),
  label: text,
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
}).strict().superRefine((f, ctx) => {
  const choice = ['dropdown', 'radio', 'checkbox'].includes(f.type)
  if (choice && (!f.options.length || new Set(f.options).size !== f.options.length)) ctx.addIssue({ code: 'custom', message: 'Choice fields need 1–30 unique options', path: ['options'] })
  if (!choice && f.options.length) ctx.addIssue({ code: 'custom', message: 'Only choice fields can have options', path: ['options'] })
  if (f.type === 'message' && f.required) ctx.addIssue({ code: 'custom', message: 'A message cannot require an answer', path: ['required'] })
})
export const enrollmentFieldsSchema = z.array(enrollmentFieldSchema).max(20).superRefine((fields, ctx) => {
  if (new Set(fields.map(f => f.id)).size !== fields.length) ctx.addIssue({ code: 'custom', message: 'Field identifiers must be unique' })
})
export const emailContentSchema = z.object({
  subject: z.string().trim().max(150).refine(v => !/[\r\n]/.test(v), 'Subject must be one line').default(''),
  message: z.string().trim().max(5000).default(''),
}).strict()
export const enrollmentSettingsSchema = z.object({ fields: enrollmentFieldsSchema.default([]), email: emailContentSchema.default({}) }).strict()
export type EnrollmentField = z.infer<typeof enrollmentFieldSchema>
export function readEnrollmentSettings(value: unknown) { return enrollmentSettingsSchema.parse(value) }
export function validateEnrollmentResponses(fields: unknown, input: unknown): Prisma.InputJsonObject {
  const schema = enrollmentFieldsSchema.parse(fields)
  const parsed = z.record(z.union([z.string().max(1000), z.array(z.string().max(120)).max(30)])).safeParse(input ?? {})
  if (!parsed.success) throw new WorkspaceError(400, 'INVALID_ENROLLMENT', 'Check your workspace details')
  const values = parsed.data, result: Record<string, string | string[]> = Object.create(null)
  const answerable = schema.filter(f => f.type !== 'message')
  if (Object.keys(values).some(key => !answerable.some(f => f.id === key))) throw new WorkspaceError(400, 'INVALID_ENROLLMENT', 'The form contains an unknown field. Reopen the invitation')
  for (const f of answerable) {
    const value = values[f.id]
    const empty = value === undefined || (typeof value === 'string' ? !value.trim() : value.length === 0)
    if (empty) { if (f.required) throw new WorkspaceError(400, 'INVALID_ENROLLMENT', `Complete ${f.label}`); continue }
    if (f.type === 'checkbox') {
      if (!Array.isArray(value) || new Set(value).size !== value.length || value.some(v => !f.options.includes(v))) throw new WorkspaceError(400, 'INVALID_ENROLLMENT', `Choose valid options for ${f.label}`)
      result[f.id] = value
    } else {
      if (typeof value !== 'string' || (f.type !== 'text' && !f.options.includes(value))) throw new WorkspaceError(400, 'INVALID_ENROLLMENT', `Check ${f.label}`)
      result[f.id] = value.trim()
    }
  }
  return result
}
export async function saveEnrollmentSettings(tx: WorkspaceTx, workspaceId: string, actorId: string, input: unknown) {
  const settings = enrollmentSettingsSchema.parse(input)
  const workspace = await tx.workspace.findUnique({ where: { id: workspaceId } })
  if (!workspace || workspace.kind !== 'ORGANIZATION') throw new WorkspaceError(404, 'WORKSPACE_NOT_FOUND', 'Organization not found')
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${workspaceId} FOR UPDATE`
  await tx.workspace.update({ where: { id: workspaceId }, data: { enrollmentSettings: settings } })
  await tx.workspaceAudit.create({ data: { workspaceId, actorUserId: actorId, action: 'enrollment_settings_updated', metadata: { fieldCount: settings.fields.length } } })
  return settings
}
export async function saveManagedEnrollment(tx: WorkspaceTx, scope: Awaited<ReturnType<typeof establishWorkspace>>, input: unknown) {
  requireWorkspaceManager(scope)
  return saveEnrollmentSettings(tx, scope.workspace.id, scope.member.userId, input)
}
