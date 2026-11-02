import { existsSync, realpathSync } from 'fs'
import { isAbsolute, join, relative, resolve } from 'path'
import { currentDataScope, type DataScope } from './dataScope'

const safeId = /^[A-Za-z0-9_-]{1,160}$/

export function audioStorageRoot(): string {
  return process.env.LOCAL_AUDIO_PATH
    ? resolve(process.env.LOCAL_AUDIO_PATH)
    : join(process.cwd(), 'audio_storage')
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Relative prefix that holds every media object of one organization activity. */
export function workspaceMediaPrefix(workspaceId: string, kind: 'sessions' | 'replay', activityId: string): string {
  if (!safeId.test(workspaceId) || !safeId.test(activityId)) throw new Error('Invalid media reference')
  return `workspaces/${workspaceId}/${kind}/${activityId}`
}

/**
 * Directory for new media of one activity. Personal media keeps its historical
 * location; organization media is always written under its workspace prefix.
 */
export function activityMediaDir(root: string, kind: 'sessions' | 'replay', activityId: string, scope: DataScope | undefined = currentDataScope()): string {
  if (!scope) return root
  return join(root, workspaceMediaPrefix(scope.workspaceId, kind, activityId))
}

/**
 * Organization media may only be read from its own workspace prefix, so a stored
 * path cannot reach another tenant, Personal files or the agent's shared folder.
 */
export function mediaPathAllowed(absolutePath: string, scope: DataScope | undefined = currentDataScope(), root = audioStorageRoot()): boolean {
  if (!scope) return true
  const prefix = resolve(root, 'workspaces', scope.workspaceId)
  if (!isInside(prefix, resolve(absolutePath))) return false
  if (!existsSync(absolutePath)) return true
  try {
    const real = realpathSync(absolutePath)
    return isInside(realpathSync(prefix), real)
  } catch {
    return false
  }
}
