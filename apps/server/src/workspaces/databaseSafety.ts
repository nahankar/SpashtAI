import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { WorkspaceError, workspacesEnabled } from './contracts'

export const WORKSPACE_RLS_TABLES = ['Workspace', 'WorkspaceMember', 'WorkspaceFeature', 'WorkspaceMemberFeature', 'WorkspaceAudit',
  'Session', 'SessionMetrics', 'SessionTranscript', 'SessionSegment', 'SessionTurn', 'SessionRecording', 'UserInvitation',
  'ReplaySession', 'ReplayUpload', 'ReplayResult', 'Preparation', 'InterviewPreparation', 'PreparationStage', 'InterviewQuestion',
  'StageReflection', 'PreparationPractice', 'PreparationRecording', 'ProgressPulse', 'FeatureUsage', 'CoachThread', 'CoachTurn',
  'CoachAction', 'CoachHomeResultReceipt', 'UserFeedback', 'UserFeedbackAttachment', 'UserFeedbackNote', 'RecordingAcknowledgment',
  'InterviewRun', 'InterviewAttempt', 'InterviewCaptureReceipt', 'InterviewAnswerChunk', 'InterviewTranscriptIssue',
  'InterviewAnswerSnapshot', 'InterviewAssessment', 'InterviewEvaluatorUsage', 'BankFollowUpJob', 'WorkspaceAnalyticsQuery'] as const

export async function assertWorkspaceDatabaseSafety(db: Pick<PrismaClient, '$queryRaw'> = prisma) {
  const roles = await db.$queryRaw<Array<{ bypass: boolean }>>`SELECT
    (rolsuper OR rolbypassrls OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN (${Prisma.join([...WORKSPACE_RLS_TABLES])})
      AND pg_has_role(current_user,c.relowner,'MEMBER'))) AS bypass
    FROM pg_roles WHERE rolname=current_user`
  if (roles[0]?.bypass !== false) throw new WorkspaceError(503, 'WORKSPACE_DATABASE_ROLE_UNSAFE', 'Workspaces require a non-owner database role that enforces row isolation')
  const tables = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN (${Prisma.join([...WORKSPACE_RLS_TABLES])}) AND c.relrowsecurity AND c.relforcerowsecurity`
  if (Number(tables[0]?.count) !== WORKSPACE_RLS_TABLES.length) throw new WorkspaceError(503, 'WORKSPACE_POLICIES_UNAVAILABLE', 'Workspace row isolation is not installed')
}

/** A flag rollback must never expose tenant records through a privileged legacy connection. */
export async function assertSafeWorkspaceStartup(db: Pick<PrismaClient, '$queryRaw'> = prisma) {
  if (workspacesEnabled()) return assertWorkspaceDatabaseSafety(db)
  const roles = await db.$queryRaw<Array<{ bypass: boolean }>>`SELECT (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname=current_user`
  if (roles[0]?.bypass) {
    const rows = await db.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS(SELECT 1 FROM "Session" WHERE "workspaceKind"='ORGANIZATION') AS present`
    if (rows[0]?.present) throw new Error('Organization sessions require a restricted runtime database role even when workspace rollout is disabled')
  }
}
