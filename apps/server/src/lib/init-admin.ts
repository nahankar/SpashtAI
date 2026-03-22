import { prisma } from './prisma'
import { hashPassword } from './password'

export async function ensureAdminExists(): Promise<void> {
  const email = process.env.ADMIN_EMAIL || 'admin@spasht.ai'
  const password = process.env.ADMIN_PASSWORD || 'nimda'

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

  console.log('⚠️  ========================================')
  console.log('⚠️  HARD-CODED ADMIN CREDENTIALS ACTIVE')
  console.log(`⚠️  Email: ${email}`)
  console.log(`⚠️  Password: ${password}`)
  console.log('⚠️  REMOVE BEFORE PRODUCTION DEPLOYMENT')
  console.log('⚠️  ========================================')
}
