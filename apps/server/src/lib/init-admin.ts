import { prisma } from './prisma'
import { hashPassword } from './password'

export async function ensureAdminExists(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production'
  const seedEnabled = process.env.SEED_ADMIN === 'true'

  if (isProduction && !seedEnabled) {
    return
  }

  const email = process.env.ADMIN_EMAIL || 'admin@spasht.ai'
  const password = process.env.ADMIN_PASSWORD || (isProduction ? undefined : 'nimda')

  if (!password) {
    console.warn('⚠️  Admin seed skipped: set ADMIN_PASSWORD when SEED_ADMIN=true')
    return
  }

  const existing = await prisma.user.findUnique({ where: { email } })

  if (!existing) {
    const passwordHash = await hashPassword(password)
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: 'Admin',
        role: 'SUPER_ADMIN',
        emailVerified: true,
      },
    })
    console.log(`✅ Admin account created: ${email}`)
  }

  if (!isProduction) {
    console.log('⚠️  ========================================')
    console.log('⚠️  DEV ADMIN CREDENTIALS (local only)')
    console.log(`⚠️  Email: ${email}`)
    console.log(`⚠️  Password: ${password}`)
    console.log('⚠️  ========================================')
  }
}
