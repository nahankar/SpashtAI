import type { Request, Response } from 'express'

export function listPersonas(_req: Request, res: Response) {
  res.json({ personas: [] })
}

export function getPersona(req: Request, res: Response) {
  res.json({ persona: { id: req.params.id } })
}


