import { prisma } from './prisma'
import { DEFAULT_PRIVACY, DEFAULT_TERMS } from './legal-defaults'

const SEEDS = [
  { slug: 'terms', title: 'Terms and Conditions', content: DEFAULT_TERMS },
  { slug: 'privacy', title: 'Privacy Policy', content: DEFAULT_PRIVACY },
] as const

export async function ensureLegalDocuments(): Promise<void> {
  for (const doc of SEEDS) {
    const existing = await prisma.legalDocument.findUnique({ where: { slug: doc.slug } })
    if (!existing) {
      await prisma.legalDocument.create({
        data: { slug: doc.slug, title: doc.title, content: doc.content },
      })
    } else if (!existing.content.trim()) {
      await prisma.legalDocument.update({
        where: { slug: doc.slug },
        data: { title: doc.title, content: doc.content },
      })
    }
  }
}
