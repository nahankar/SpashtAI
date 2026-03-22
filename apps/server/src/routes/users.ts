import type { Request, Response } from 'express'

export function listUsers(_req: Request, res: Response) {
  res.json({ users: [] })
}

export function getUser(req: Request, res: Response) {
  res.json({ user: { id: req.params.id } })
}

export function createUser(_req: Request, res: Response) {
  res.status(201).json({ ok: true })
}

export function updateUser(req: Request, res: Response) {
  res.json({ ok: true, id: req.params.id })
}

export function deleteUser(req: Request, res: Response) {
  res.status(204).send()
}


