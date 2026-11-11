import type { z } from 'zod'
import { prisma } from './prisma'
import { getPlatformSettings } from './platformSettings'
import { withWorkspaceActor } from '../workspaces/context'
import { WorkspaceError } from '../workspaces/contracts'

import { accessPolicySchema } from './signInPolicyContracts'
export { accessPolicySchema, signInPolicySchema } from './signInPolicyContracts'
export type SignInMethod = 'google' | 'emailCode' | 'invitation'
export function methodsFor(value: { googleSignInEnabled: boolean; emailCodeSignInEnabled: boolean }) {
  return { google: value.googleSignInEnabled, emailCode: value.emailCodeSignInEnabled }
}
export function policyData(policy: z.infer<typeof accessPolicySchema>) {
  return { googleSignInEnabled: policy.methods.google, emailCodeSignInEnabled: policy.methods.emailCode, learnerEmailDomains: policy.learnerEmailDomains }
}
export function requireMethod(methods: { google: boolean; emailCode: boolean }, method: SignInMethod) {
  if (method !== 'invitation' && !methods[method]) throw new WorkspaceError(403, 'SIGN_IN_METHOD_DISABLED', `Sign in using ${methods.emailCode ? 'an emailed code' : 'Google'} for this account.`)
}
/** Existing memberships are grandfathered; administrative roles are exempt for future enrollment. */
export function requireLearnerDomain(workspace: { learnerEmailDomains: string[] }, email: string, role: string, existingMember = false) {
  if (existingMember || role !== 'LEARNER' || !workspace.learnerEmailDomains.length) return
  if (!workspace.learnerEmailDomains.includes(email.trim().toLowerCase().split('@')[1])) {
    throw new WorkspaceError(403, 'EMAIL_DOMAIN_NOT_ALLOWED', `New Learners must use an email ending in ${workspace.learnerEmailDomains.map(d => `@${d}`).join(' or ')}.`)
  }
}
/** Returns only public branding and sign-in choices, never membership or account information. */
export async function publicSignInPolicy(slug?: string) {
  if (!slug) return { methods: methodsFor(await getPlatformSettings()), workspace: null }
  const rows = await prisma.$queryRaw<Array<{ policy: { methods: { google: boolean; emailCode: boolean }; workspace: { name: string; slug: string }; learnerEmailDomains: string[] } }>>`SELECT public.workspace_sign_in_policy(${slug}) AS policy`
  if (!rows[0]?.policy) throw new WorkspaceError(404, 'WORKSPACE_NOT_FOUND', 'This workspace is not available')
  return rows[0].policy
}
/** Generic sign-in resolves existing organization policies; a client cannot escape them by omitting its slug. */
export async function assertAccountSignIn(email: string, method: SignInMethod, slug?: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, tenantOnly: true } })
  if (slug) {
    const policy = await publicSignInPolicy(slug)
    requireMethod(policy.methods, method)
    const member = user && await withWorkspaceActor(user.id, tx => tx.workspaceMember.findFirst({ where: { userId: user.id, state: { in: ['ACTIVE', 'INVITED'] }, workspace: { slug, kind: 'ORGANIZATION', state: 'ACTIVE' } } }))
    if (!member) throw new WorkspaceError(403, 'INVITATION_REQUIRED', 'Accept an invitation to this workspace before signing in.')
    return
  }
  if (user?.tenantOnly) {
    const memberships = await withWorkspaceActor(user.id, tx => tx.workspaceMember.findMany({
      where: { userId: user.id, state: { in: ['ACTIVE', 'INVITED'] }, workspace: { kind: 'ORGANIZATION', state: 'ACTIVE' } }, include: { workspace: true },
    }))
    if (memberships.some(m => method === 'invitation' || methodsFor(m.workspace)[method])) return
    throw new WorkspaceError(403, 'SIGN_IN_METHOD_DISABLED', 'Use a sign-in method enabled by your organization.')
  }
  requireMethod(methodsFor(await getPlatformSettings()), method)
}

export function requireWorkspaceMethod(value: Parameters<typeof methodsFor>[0], method?: SignInMethod) {
  const methods = methodsFor(value)
  if (method === 'invitation' || (method && methods[method]) || (!method && methods.google && methods.emailCode)) return
  throw new WorkspaceError(401, 'SIGN_IN_REQUIRED', `Sign in again using ${methods.emailCode ? 'an emailed code' : 'Google'} for this workspace.`)
}
