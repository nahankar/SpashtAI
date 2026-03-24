import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma'

export async function getSkillProgress(req: Request, res: Response) {
  try {
    const userId = req.user!.userId
    const { skill, limit: rawLimit } = req.query
    const take = Math.min(Number(rawLimit) || 50, 200)

    const where: any = { userId }
    if (skill && typeof skill === 'string') {
      where.skill = skill
    }

    const records = await prisma.skillProgress.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take,
    })

    res.json({ progress: records })
  } catch (error) {
    console.error('Error fetching skill progress:', error)
    res.status(500).json({ error: 'Failed to fetch skill progress' })
  }
}

export async function getSkillSummary(req: Request, res: Response) {
  try {
    const userId = req.user!.userId

    const latestPerSkill = await prisma.$queryRaw<
      { skill: string; latest_score: number; prev_score: number | null; count: number }[]
    >`
      WITH ranked AS (
        SELECT
          skill,
          score,
          "recordedAt",
          ROW_NUMBER() OVER (PARTITION BY skill ORDER BY "recordedAt" DESC) AS rn,
          COUNT(*) OVER (PARTITION BY skill) AS cnt
        FROM "SkillProgress"
        WHERE "userId" = ${userId}
      )
      SELECT
        r1.skill,
        r1.score AS latest_score,
        r2.score AS prev_score,
        r1.cnt::int AS count
      FROM ranked r1
      LEFT JOIN ranked r2 ON r1.skill = r2.skill AND r2.rn = 2
      WHERE r1.rn = 1
      ORDER BY r1.skill
    `

    const summary = latestPerSkill.map((row) => ({
      skill: row.skill,
      currentScore: Number(row.latest_score),
      previousScore: row.prev_score != null ? Number(row.prev_score) : null,
      delta: row.prev_score != null ? Number(row.latest_score) - Number(row.prev_score) : null,
      totalSessions: Number(row.count),
    }))

    res.json({ summary })
  } catch (error) {
    console.error('Error fetching skill summary:', error)
    res.status(500).json({ error: 'Failed to fetch skill summary' })
  }
}

export async function recordSkillProgress(req: Request, res: Response) {
  try {
    const userId = req.user!.userId
    const { entries } = req.body

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries array is required' })
    }

    const records = await prisma.skillProgress.createMany({
      data: entries.map((e: any) => ({
        userId,
        skill: e.skill,
        score: Number(e.score),
        source: e.source || 'replay',
        sessionId: e.sessionId || null,
        metadata: e.metadata || null,
      })),
    })

    res.status(201).json({ success: true, count: records.count })
  } catch (error) {
    console.error('Error recording skill progress:', error)
    res.status(500).json({ error: 'Failed to record skill progress' })
  }
}
