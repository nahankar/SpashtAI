import type { PrismaClient } from '@prisma/client'

/** Parallel suites share one restricted role; PostgreSQL GRANT catalog writes need serialization. */
export async function prepareWorkspaceTestRole(admin: PrismaClient) {
  await admin.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(55443, 1)::text`
    await tx.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='tenancy_test_app') THEN CREATE ROLE tenancy_test_app LOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$`)
    await tx.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO tenancy_test_app')
    await tx.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tenancy_test_app')
    await tx.$executeRawUnsafe('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tenancy_test_app')
  })
}
