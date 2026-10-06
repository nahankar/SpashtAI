import { PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Intentionally require an explicit environment URL, never implicitly use .env.
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL explicitly for the empty database to initialize')
const prismaDir = fileURLToPath(new URL('../', import.meta.url))
const cli = path.resolve(prismaDir, '../../..', 'node_modules/prisma/build/index.js')
const db = new PrismaClient()
try {
  const objects = await db.$queryRaw`SELECT table_name FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`
  if (objects.length) throw new Error('Refusing to baseline a database containing tables; use migrate deploy for upgrades')
} finally {
  await db.$disconnect()
}
function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--schema', path.join(prismaDir, 'schema.prisma')], {
    env: process.env, stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error('Baseline initialization failed; inspect the target database before retrying')
}
run(['db', 'execute', '--file', path.join(prismaDir, 'phase0-baseline.sql')])
// Freeze this list with the snapshot. Future migrations must execute normally.
const migrations = JSON.parse(await readFile(path.join(prismaDir, 'phase0-baseline-migrations.json'), 'utf8'))
for (const migration of migrations) run(['migrate', 'resolve', '--applied', migration])
console.log('Empty database initialized and historical migrations baselined. Run migrate deploy for subsequent migrations.')
