/** Explicit release step. Never prints URLs or passwords. Run only after migrations, with API stopped. */
import { PrismaClient } from '@prisma/client'
import { parse } from 'dotenv'
import { readFile, writeFile, copyFile, chmod, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
const envPath = resolve(process.argv[2] || '.env')
if (!process.argv.includes('--apply')) throw new Error('Explicit --apply required; API must be stopped and migrations installed')
const source = await readFile(envPath, 'utf8'), env = parse(source)
const migrationFileIndex = process.argv.indexOf('--migration-env')
const migrationPath = migrationFileIndex >= 0 ? resolve(process.argv[migrationFileIndex + 1]) : resolve(envPath, '../../../.deploy-migration.env')
let savedMigration = {}
try { savedMigration = parse(await readFile(migrationPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const migrationUrl = savedMigration.MIGRATION_DATABASE_URL || env.MIGRATION_DATABASE_URL || env.DATABASE_URL
if (!migrationUrl) throw new Error('Migration database configuration required')
const parsed = new URL(migrationUrl)
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('This release helper supports the local production PostgreSQL service only')
const admin = new PrismaClient({ datasourceUrl: migrationUrl })
const role = 'spashtai_runtime', quote = value => '"' + value.replaceAll('"', '""') + '"'
let phase = 'preflight'
try {
  const policy = await admin.$queryRaw`SELECT count(*) AS count FROM pg_class WHERE relname IN ('Workspace','WorkspaceMember','WorkspaceFeature','WorkspaceMemberFeature','WorkspaceAudit','Session','SessionMetrics','SessionTranscript','SessionSegment','SessionTurn','SessionRecording','UserInvitation') AND relrowsecurity AND relforcerowsecurity`
  if (Number(policy[0]?.count) !== 12) throw new Error('Required RLS migrations are not installed')
  const actor = await admin.$queryRaw`SELECT current_user AS name`
  const existing = await admin.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname=${role}`
  const current = new URL(env.DATABASE_URL)
  if (existing.length && current.username !== role) throw new Error('Runtime role already exists but is not the configured runtime; review manually')
  const password = current.username === role ? decodeURIComponent(current.password) : randomBytes(36).toString('base64url')
  phase = 'role'
  await admin.$transaction(async tx => {
    if (!existing.length) await tx.$executeRawUnsafe(`CREATE ROLE ${quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${password}'`)
    await tx.$executeRawUnsafe(`ALTER ROLE ${quote(role)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`)
    await tx.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${quote(decodeURIComponent(parsed.pathname.slice(1)))} TO ${quote(role)}`)
    await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${quote(role)}`)
    await tx.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quote(role)}`)
    await tx.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quote(role)}`)
    await tx.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(actor[0].name)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quote(role)}`)
    await tx.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(actor[0].name)} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quote(role)}`)
  })
  const runtimeUrl = new URL(migrationUrl); runtimeUrl.username = role; runtimeUrl.password = password
  const runtime = new PrismaClient({ datasourceUrl: runtimeUrl.toString() })
  try {
    phase = 'runtime verification'
    const rows = await runtime.$queryRaw`SELECT (rolsuper OR rolbypassrls OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user))) AS unsafe FROM pg_roles WHERE rolname=current_user`
    if (rows[0]?.unsafe !== false) throw new Error('Runtime role is unsafe')
    await runtime.user.count(); await runtime.session.count()
  } finally { await runtime.$disconnect() }
  phase = 'configuration'
  const changes = { DATABASE_URL: runtimeUrl.toString(), WORKSPACES_ENABLED: 'true', WORKSPACE_SESSION_ARCHIVE_ENABLED: 'false', SMTP_PORT: env.SMTP_PORT || '465', SMTP_USER: env.SMTP_USER || 'info@spasht.ai', SMTP_FROM: env.SMTP_FROM || 'SpashtAI <info@spasht.ai>' }
  let next = source.replace(/^MIGRATION_DATABASE_URL=.*(?:\r?\n|$)/gm, '')
  for (const [key,value] of Object.entries(changes)) {
    const line = `${key}=${JSON.stringify(value)}`
    const pattern = new RegExp(`^${key}=.*$`, 'gm')
    next = pattern.test(next) ? next.replace(pattern, () => line) : next + '\n' + line + '\n'
  }
  await writeFile(migrationPath, `MIGRATION_DATABASE_URL=${JSON.stringify(migrationUrl)}\n`, { mode: 0o600 }); await chmod(migrationPath, 0o600)
  const backup = `${envPath}.pre-workspace-${Date.now()}`
  await copyFile(envPath, backup); await chmod(backup, 0o600)
  const temporary = `${envPath}.workspace-tmp`
  await writeFile(temporary, next, { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, envPath)
  console.log('Restricted runtime configured; privileged migration credentials retained separately. Workspace practices and archive remain disabled. No SMTP password changed.')
} catch {
  console.error(`Workspace runtime setup failed during ${phase}; no credentials printed`)
  process.exitCode = 1
} finally { await admin.$disconnect() }
