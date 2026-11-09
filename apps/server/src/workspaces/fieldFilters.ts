import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { filterableEnrollmentFields } from './enrollment'
import { WorkspaceError } from './contracts'
import { requireWorkspaceManager, type WorkspaceTx, type establishWorkspace } from './context'

type Scope = Awaited<ReturnType<typeof establishWorkspace>>
export const fieldQuerySchema = z.preprocess(
  value => typeof value === 'string' ? [value] : value,
  z.array(z.string().min(3).max(162)).max(10).default([]),
)
export type FieldSelection = { id: string; values: string[] }

export function resolveFieldSelections(scope: Scope, input: unknown): FieldSelection[] {
  const fields = filterableEnrollmentFields(scope.workspace.enrollmentSettings)
  const groups = new Map<string, Set<string>>()
  for (const entry of fieldQuerySchema.parse(input)) {
    const colon = entry.indexOf(':')
    const id = entry.slice(0, colon), value = entry.slice(colon + 1)
    const field = fields.find(f => f.id === id)
    if (colon < 1 || !field || (value !== '__none__' && !field.options.includes(value))) {
      throw new WorkspaceError(400, 'INVALID_FIELD_FILTER', 'Choose a currently enabled workspace field and option')
    }
    const values = groups.get(id) ?? new Set<string>()
    values.add(value); groups.set(id, values)
  }
  return [...groups].map(([id, values]) => ({ id, values: [...values] }))
}

/** Membership answers, never profile attributes; each subquery is bound to the authorized tenant. */
export function fieldMemberQuery(workspaceId: string, selections: FieldSelection[]) {
  const predicates = selections.map(({ id, values }) => Prisma.sql`(${Prisma.join(values.map(value =>
    value === '__none__'
      ? Prisma.sql`("enrollmentResponses" -> ${id} IS NULL OR "enrollmentResponses" -> ${id} IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb))`
      : Prisma.sql`("enrollmentResponses" -> ${id} = ${JSON.stringify(value)}::jsonb OR
          (jsonb_typeof("enrollmentResponses" -> ${id}) = 'array' AND "enrollmentResponses" -> ${id} @> ${JSON.stringify([value])}::jsonb))`,
  ), ' OR ')})`)
  return Prisma.sql`SELECT "userId" FROM "WorkspaceMember" WHERE "workspaceId" = ${workspaceId}
    ${predicates.length ? Prisma.sql`AND ${Prisma.join(predicates, ' AND ')}` : Prisma.empty}`
}

export async function fieldMemberWhere(tx: WorkspaceTx, scope: Scope, selections: FieldSelection[]) {
  if (!selections.length) return {}
  const rows = await tx.$queryRaw<Array<{ userId: string }>>(fieldMemberQuery(scope.workspace.id, selections))
  return { userId: { in: rows.map(row => row.userId) } }
}

export function workspaceFieldFilters(scope: Scope) {
  requireWorkspaceManager(scope)
  return filterableEnrollmentFields(scope.workspace.enrollmentSettings).map(({ id, label, options }) => ({ id, label, options }))
}
