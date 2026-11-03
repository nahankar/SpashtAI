import { withPlatformWorkspaceAdmin } from '../workspaces/context'
import { WorkspaceError } from '../workspaces/contracts'

export type PlatformPracticeScope = {
  kind: 'platform'
  workspaceId: string | null
  practice: 'all-workspaces' | 'workspace'
}

export type PlatformPracticeTotals = {
  elevateTotal: number
  elevateMonth: number
  replayTotal: number
  replayMonth: number
  interviewRuns: number
  pulseParticipants: number
}

type Row = {
  elevate_total: bigint
  elevate_month: bigint
  replay_total: bigint
  replay_month: bigint
  interview_runs: bigint
  pulse_participants: bigint
}

function asCount(value: bigint | number | null | undefined) {
  return Number(value ?? 0)
}

/** Authorized platform-wide aggregates. Raw learner content stays behind tenant RLS. */
export async function loadPlatformPracticeTotals(actorId: string, workspaceId: string | null) {
  return withPlatformWorkspaceAdmin(actorId, async tx => {
    if (workspaceId) {
      const workspace = await tx.workspace.findFirst({ where: { id: workspaceId, kind: 'ORGANIZATION' }, select: { id: true } })
      if (!workspace) throw new WorkspaceError(404, 'WORKSPACE_NOT_FOUND', 'Organization workspace not found')
    }
    const rows = await tx.$queryRaw<Row[]>`SELECT * FROM public.platform_practice_totals(${workspaceId})`
    const row = rows[0]
    if (!row) throw new WorkspaceError(403, 'PLATFORM_ADMIN_REQUIRED', 'Platform administrator access is required')
    const membersInWorkspace = workspaceId
      ? await tx.workspaceMember.count({ where: { workspaceId, state: 'ACTIVE' } })
      : null
    const scope: PlatformPracticeScope = {
      kind: 'platform',
      workspaceId,
      practice: workspaceId ? 'workspace' : 'all-workspaces',
    }
    const totals: PlatformPracticeTotals = {
      elevateTotal: asCount(row.elevate_total),
      elevateMonth: asCount(row.elevate_month),
      replayTotal: asCount(row.replay_total),
      replayMonth: asCount(row.replay_month),
      interviewRuns: asCount(row.interview_runs),
      pulseParticipants: asCount(row.pulse_participants),
    }
    return { scope, totals, membersInWorkspace }
  })
}
