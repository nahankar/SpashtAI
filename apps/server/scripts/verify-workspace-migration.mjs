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
  const policies = await db.$queryRaw`SELECT count(*) AS count FROM pg_class WHERE relname IN ('Workspace','WorkspaceMember','WorkspaceFeature','WorkspaceMemberFeature','WorkspaceAudit','Session','SessionMetrics','SessionTranscript','SessionSegment','SessionTurn','SessionRecording','UserInvitation') AND relrowsecurity AND relforcerowsecurity`
  assert.equal(Number(policies[0].count), 12)
  console.log('Upgrade/backfill passed: Personal ownership preserved; twelve workspace/session/invitation tables enforce RLS.')
} finally {
  await db?.$disconnect()
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
  await admin.$disconnect()
  await rm(directory, { recursive: true, force: true })
}
