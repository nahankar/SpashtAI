import type { Request, Response } from 'express'

export function getSettings(_req: Request, res: Response) {
  res.json({ settings: {} })
}

export function updateSettings(_req: Request, res: Response) {
  res.json({ ok: true })
}


