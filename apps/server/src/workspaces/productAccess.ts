import type { Workspace, WorkspaceMember } from '@prisma/client'
import { effectiveWorkspaceFeature, WORKSPACE_FEATURES, type FeatureDecision } from './contracts'
import type { WorkspaceTx } from './context'

export type WorkspaceFeatureId = typeof WORKSPACE_FEATURES[number]

/**
 * A feature is ready only after its complete organization path (records, raw SQL,
 * media, voice callbacks, live updates, workers, exports and browser recovery) is
 * scoped and tested. This is product code, identical for every organization;
 * tenant settings cannot override it.
 */
export const WORKSPACE_FEATURE_READINESS: Record<WorkspaceFeatureId, boolean> = {
  elevate: false,
  replay: false,
  interviews: false,
  progress_pulse: false,
  feedback: false,
  pro: true,
  ultra: true,
  audio_export: false,
  text_export: false,
  coach: false,
  prepare: false,
  reprocess: false,
}

/**
 * Platform switches that must be operational for an organization feature. Inside
 * an organization the workspace entitlement is the platform's selection, so a
 * Personal pilot grant (UserFeatureGrant) is neither required nor sufficient.
 */
export const PLATFORM_FLAGS_FOR: Partial<Record<WorkspaceFeatureId, string[]>> = {
  elevate: ['elevate'],
  replay: ['replay'],
  interviews: ['interviews', 'interview_voice'],
  prepare: ['prepare'],
}

type FlagRow = { feature: string; hidden: boolean; disabled: boolean }

export function platformOperational(feature: string, flags: FlagRow[]): boolean {
  const required = PLATFORM_FLAGS_FOR[feature as WorkspaceFeatureId] ?? []
  return required.every(name => {
    const flag = flags.find(row => row.feature === name)
    return Boolean(flag && !flag.hidden && !flag.disabled)
  })
}

export interface MemberFeatureDecision {
  feature: WorkspaceFeatureId
  entitled: boolean
  enabled: boolean
  memberDefault: boolean
  memberOverride: boolean | null
  ready: boolean
  allowed: boolean
  reason: string | null
}

export async function memberFeatureDecisions(
  tx: WorkspaceTx,
  workspace: Pick<Workspace, 'id' | 'state' | 'kind'>,
  member: Pick<WorkspaceMember, 'id' | 'state'>,
): Promise<MemberFeatureDecision[]> {
  const [flags, policies, overrides] = await Promise.all([
    tx.platformFeatureFlag.findMany({ select: { feature: true, hidden: true, disabled: true } }),
    tx.workspaceFeature.findMany({ where: { workspaceId: workspace.id } }),
    tx.workspaceMemberFeature.findMany({ where: { workspaceId: workspace.id, memberId: member.id } }),
  ])
  return WORKSPACE_FEATURES.map(feature => {
    const policy = policies.find(row => row.feature === feature) as FeatureDecision | undefined
    const override = overrides.find(row => row.feature === feature)?.allowed
    const ready = WORKSPACE_FEATURE_READINESS[feature]
    const decision = effectiveWorkspaceFeature({
      workspaceActive: workspace.state === 'ACTIVE' && workspace.kind === 'ORGANIZATION',
      memberActive: member.state === 'ACTIVE',
      tenantReady: ready,
      platformAllowed: platformOperational(feature, flags),
      policy,
      memberOverride: override,
    })
    return {
      feature, entitled: policy?.entitled ?? false, enabled: policy?.enabled ?? false,
      memberDefault: policy?.memberDefault ?? true, memberOverride: override ?? null, ready, ...decision,
    }
  })
}

export function featureMap(decisions: MemberFeatureDecision[]): Record<string, boolean> {
  return Object.fromEntries(decisions.map(row => [row.feature, row.allowed]))
}

/** Organization plan tier from entitled, enabled and member-allowed plan features. */
export function workspacePlan(features: Record<string, boolean>): 'ultra' | 'pro' | 'standard' {
  if (features.ultra) return 'ultra'
  if (features.pro) return 'pro'
  return 'standard'
}
