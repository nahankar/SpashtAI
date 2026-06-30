/**
 * Read-only account/session diagnostic.
 *
 * Usage (run from apps/server with the prod env loaded, e.g. on EC2):
 *   npx tsx scripts/diagnose-accounts.ts [sessionId]
 *
 * It reports:
 *   1. Every user (id, email, googleId?, role, #sessions, created date)
 *   2. Any users sharing a normalized email (true duplicates)
 *   3. The owner of an optional sessionId argument
 *
 * Nothing is written — safe to run against production.
 */
import { prisma } from '../src/lib/prisma'

async function main() {
  const sessionId = process.argv[2]?.trim()

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      googleId: true,
      role: true,
      createdAt: true,
      _count: { select: { sessions: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`\n=== USERS (${users.length}) ===`)
  for (const u of users) {
    console.log(
      [
        u.email.padEnd(34),
        `id=${u.id}`,
        `role=${u.role}`,
        `google=${u.googleId ? 'yes' : 'no'}`,
        `sessions=${u._count.sessions}`,
        `created=${u.createdAt.toISOString().slice(0, 10)}`,
      ].join('  '),
    )
  }

  const byEmail = new Map<string, typeof users>()
  for (const u of users) {
    const key = u.email.trim().toLowerCase()
    const arr = byEmail.get(key) ?? []
    arr.push(u)
    byEmail.set(key, arr)
  }
  const dupes = [...byEmail.entries()].filter(([, arr]) => arr.length > 1)
  console.log(`\n=== DUPLICATE EMAILS (${dupes.length}) ===`)
  if (dupes.length === 0) {
    console.log('None — no two accounts share the same normalized email.')
  } else {
    for (const [email, arr] of dupes) {
      console.log(`${email}: ${arr.map((u) => u.id).join(', ')}`)
    }
  }

  if (sessionId) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        sessionName: true,
        endedAt: true,
        startedAt: true,
        user: { select: { id: true, email: true, role: true } },
      },
    })
    console.log(`\n=== SESSION ${sessionId} ===`)
    if (!session) {
      console.log('Not found.')
    } else {
      console.log(`name      : ${session.sessionName ?? '(none)'}`)
      console.log(`status    : ${session.endedAt ? 'completed' : 'in-progress'}`)
      console.log(`started   : ${session.startedAt.toISOString()}`)
      console.log(`owner     : ${session.user.email} (id=${session.user.id}, role=${session.user.role})`)
    }
  } else {
    console.log('\n(Tip: pass a sessionId to see who owns it, e.g. `npx tsx scripts/diagnose-accounts.ts session_1782800332658_7omsgnp87`)')
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
