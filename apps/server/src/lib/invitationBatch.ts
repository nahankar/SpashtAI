import { z } from 'zod'
import { WorkspaceError } from '../workspaces/contracts'

export const batchEmailsSchemaFor = (max: number) => z.array(z.string().trim().toLowerCase().email().max(254)).min(1).max(max)
  .refine(emails => new Set(emails).size === emails.length, 'Remove duplicate email addresses')
export const batchEmailsSchema = batchEmailsSchemaFor(20)
// Platform recipient budget, including bulk. Tenant budgets are persisted separately
// in the workspace, using its Admin-configured allowance.
const sends = new Map<string, { count: number; until: number }>()
export function reserveInvitationSend(actorId: string) {
  if (process.env.NODE_ENV !== 'production') return
  const now = Date.now()
  for (const [key, row] of sends) if (row.until <= now) sends.delete(key)
  const row = sends.get(actorId) ?? { count: 0, until: now + 3600000 }
  if (row.count >= 60) throw new WorkspaceError(429, 'INVITATION_LIMIT', 'Hourly invitation limit reached. Try again later')
  row.count++; sends.set(actorId, row)
}
export async function runInvitationBatch<T>(emails: string[], send: (email: string) => Promise<T>) {
  const results: Array<{ email: string; ok: true; invitation: T } | { email: string; ok: false; error: string }> = []
  // Three concurrent deliveries; each recipient has a separate token, transaction and outcome.
  for (let i = 0; i < emails.length; i += 3) results.push(...await Promise.all(emails.slice(i, i + 3).map(async email => {
    try { return { email, ok: true as const, invitation: await send(email) } }
    catch (e) {
      const safe = e instanceof WorkspaceError || (e instanceof Error && e.name === 'InvitationError')
      return { email, ok: false as const, error: safe ? (e as Error).message : 'Could not create this invitation. Check its status before retrying' }
    }
  })))
  return { results }
}
