import { PrismaClient } from '@prisma/client'
import { createScopedPrisma } from './scopedPrisma'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function buildDatabaseUrl(): string {
  const base = process.env.DATABASE_URL ?? ''
  if (base.includes('connection_limit')) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}connection_limit=15&pool_timeout=60`
}

// Organization requests and jobs run every operation with transaction-local
// workspace settings; Personal calls pass straight through.
export const prisma =
  globalForPrisma.prisma ??
  createScopedPrisma(new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    datasources: {
      db: {
        url: buildDatabaseUrl()
      }
    }
  }))

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
