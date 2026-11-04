// Isolated upgrade/backfill check; never loads .env or targets a shared database.
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const base = process.env.WORKSPACE_TEST_DATABASE_URL
assert.equal(base, 'postgresql://postgres@127.0.0.1:55443/postgres', 'Use the dedicated tenancy test container')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const cli = resolve(root, 'node_modules/prisma/build/index.js')
const schema = resolve(root, 'apps/server/prisma/schema.prisma')
const migration = resolve(root, 'apps/server/prisma/migrations/20261101120000_workspace_foundation/migration.sql')
const directory = await mkdtemp(resolve(tmpdir(), 'spasht-tenancy-upgrade-'))
const name = `tenancy_upgrade_${Date.now()}`
const admin = new PrismaClient({ datasourceUrl: base })
let db
try {
  const before = execFileSync('git', ['show', '8e438a3:apps/server/prisma/schema.prisma'], { cwd: root, encoding: 'utf8' })
  const beforePath = resolve(directory, 'before.prisma'); await writeFile(beforePath, before)
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', beforePath, '--script'], { cwd: root, encoding: 'utf8' })
  const sqlPath = resolve(directory, 'before.sql'); await writeFile(sqlPath, sql)
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
  const url = base.replace(/postgres$/, name)
  const execute = file => execFileSync(process.execPath, [cli, 'db', 'execute', '--schema', schema, '--file', file], { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' })
  execute(sqlPath)
  db = new PrismaClient({ datasourceUrl: url })
  await db.user.create({ data: { id: 'preexisting-user', email: 'existing@example.test', emailVerified: true } })
  await db.$executeRaw`INSERT INTO "Session" (id,"userId",module) VALUES ('old-personal-session','preexisting-user','elevate')`
  await db.sessionTranscript.create({ data: { sessionId: 'old-personal-session', conversationData: { messages: [{ role: 'user', content: 'preserved answer' }] } } })
  execute(resolve(root, 'apps/server/prisma/migrations/20261031100000_user_invitations/migration.sql'))
  await db.$executeRaw`INSERT INTO "UserInvitation" (id,email,"pendingKey","tokenHash","expiresAt","invitedById","updatedAt") VALUES ('old-platform-invite','invite@example.test','invite@example.test','old-hash',CURRENT_TIMESTAMP+interval '7 days','preexisting-user',CURRENT_TIMESTAMP)`
  execute(migration)
  execute(resolve(root, 'apps/server/prisma/migrations/20261102120000_workspace_owner_deletion_guard/migration.sql'))
  // Also cover accounts created after the foundation but before this migration.
  await db.user.create({ data: { id: 'after-foundation', email: 'later@example.test' } })
  await db.$executeRaw`INSERT INTO "Session" (id,"userId",module) VALUES ('later-personal-session','after-foundation','elevate')`
  execute(resolve(root, 'apps/server/prisma/migrations/20261102140000_workspace_session_boundary/migration.sql'))
  execute(resolve(root, 'apps/server/prisma/migrations/20261102160000_workspace_invitations/migration.sql'))
  execute(resolve(root, 'apps/server/prisma/migrations/20261102190000_workspace_enrollment/migration.sql'))
  assert.deepEqual((await db.userInvitation.findUniqueOrThrow({ where: { id: 'old-platform-invite' } })).enrollmentFields, [])
  assert.equal((await db.userInvitation.findUniqueOrThrow({ where: { id: 'old-platform-invite' } })).workspaceId, null)
  const workspaces = await db.workspace.findMany({ where: { personalOwnerId: 'preexisting-user' } })
  assert.equal(workspaces.length, 1)
  assert.equal(workspaces[0].personalOwnerId, 'preexisting-user')
  assert.equal(workspaces[0].isolationStage, 'PERSONAL_LEGACY')
  const member = await db.workspaceMember.findFirstOrThrow()
  assert.equal(member.role, 'OWNER'); assert.equal(member.state, 'ACTIVE')
  const session = await db.session.findUniqueOrThrow({ where: { id: 'old-personal-session' } })
  assert.equal(session.userId, 'preexisting-user'); assert.equal(session.workspaceId, workspaces[0].id); assert.equal(session.workspaceKind, 'PERSONAL')
  assert.equal((await db.workspace.findUniqueOrThrow({ where: { personalOwnerId: 'after-foundation' } })).kind, 'PERSONAL')
  assert.equal((await db.sessionTranscript.findUniqueOrThrow({ where: { sessionId: session.id } })).conversationData.messages[0].content, 'preserved answer')
  // Product roots created before the product plane must backfill into the owner's Personal workspace.
  await db.$executeRaw`INSERT INTO "ReplaySession" (id,"userId","meetingType","userRole","focusAreas","updatedAt") VALUES ('old-replay','preexisting-user','standup','participant','{}',CURRENT_TIMESTAMP)`
  await db.$executeRaw`INSERT INTO "ProgressPulse" (id,"userId",skill,score,source) VALUES ('old-pulse','after-foundation','clarity',7,'elevate')`
  await db.$executeRaw`INSERT INTO "FeatureUsage" (id,"userId",feature,action) VALUES ('old-usage','preexisting-user','replay','view')`
  await db.$executeRaw`INSERT INTO "RecordingAcknowledgment" (id,"userId",version,scope,"textHash",source) VALUES ('old-ack','preexisting-user','v1','{}','h','test')`
  await db.$executeRaw`INSERT INTO "UserFeedback" (id,"feedbackNumber","userId",body,"updatedAt") VALUES ('old-feedback','FB-00042','preexisting-user','Earlier feedback',CURRENT_TIMESTAMP)`
  execute(resolve(root, 'apps/server/prisma/migrations/20261103090000_workspace_product_plane/migration.sql'))
  execute(resolve(root, 'apps/server/prisma/migrations/20261103120000_pilot_review_fixes/migration.sql'))
  execute(resolve(root, 'apps/server/prisma/migrations/20261103150000_workspace_job_scopes_compat/migration.sql'))
  execute(resolve(root, 'apps/server/prisma/migrations/20261103160000_workspace_job_scopes_unambiguous/migration.sql'))
  const personalOf = async user => (await db.workspace.findUniqueOrThrow({ where: { personalOwnerId: user } })).id
  for (const [table, id, user] of [['ReplaySession', 'old-replay', 'preexisting-user'], ['ProgressPulse', 'old-pulse', 'after-foundation'], ['FeatureUsage', 'old-usage', 'preexisting-user'], ['RecordingAcknowledgment', 'old-ack', 'preexisting-user']]) {
    const [row] = await db.$queryRawUnsafe(`SELECT "workspaceId","workspaceKind"::text AS kind FROM "${table}" WHERE id=$1`, id)
    assert.deepEqual(row, { workspaceId: await personalOf(user), kind: 'PERSONAL' }, `${table} backfilled to Personal`)
  }
  const [next] = await db.$queryRaw`SELECT public.next_feedback_number() AS number`
  assert.equal(next.number, 'FB-00043', 'Feedback numbering continues after existing numbers')
  const isolated = ['Workspace','WorkspaceMember','WorkspaceFeature','WorkspaceMemberFeature','WorkspaceAudit','Session','SessionMetrics','SessionTranscript','SessionSegment','SessionTurn','SessionRecording','UserInvitation',
    'ReplaySession','ReplayUpload','ReplayResult','Preparation','InterviewPreparation','PreparationStage','InterviewQuestion','StageReflection','PreparationPractice','PreparationRecording',
    'ProgressPulse','FeatureUsage','CoachThread','CoachTurn','CoachAction','CoachHomeResultReceipt','UserFeedback','UserFeedbackAttachment','UserFeedbackNote','RecordingAcknowledgment',
    'InterviewRun','InterviewAttempt','InterviewCaptureReceipt','InterviewAnswerChunk','InterviewTranscriptIssue','InterviewAnswerSnapshot','InterviewAssessment','InterviewEvaluatorUsage','BankFollowUpJob','WorkspaceAnalyticsQuery']
  const policies = await db.$queryRawUnsafe(`SELECT relname FROM pg_class WHERE relname = ANY($1) AND relrowsecurity AND relforcerowsecurity`, isolated)
  assert.deepEqual(policies.map(p => p.relname).sort(), [...isolated].sort())
  const fns = await db.$queryRaw`SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('platform_practice_totals','workspace_job_scopes')
    ORDER BY 1,2`
  assert.deepEqual(fns.map(f => `${f.proname}(${f.args})`), [
    'platform_practice_totals(p_workspace text)',
    'workspace_job_scopes(p_job text)',
    'workspace_job_scopes(p_job text, p_after_workspace text, p_after_user text, p_limit integer)',
  ])
  console.log(`Upgrade/backfill passed: Personal ownership preserved; ${isolated.length} workspace, session, product and invitation tables enforce RLS.`)
} finally {
  await db?.$disconnect()
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
  await admin.$disconnect()
  await rm(directory, { recursive: true, force: true })
}
