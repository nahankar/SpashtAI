import { describe, expect, it } from 'vitest'
import { isWorkspacePath } from './paths'
import { safeAppPath } from '../lib/safe-next-path'

describe('workspace login return paths', () => {
  it('classifies workspace pages separately from Personal telemetry', () => {
    for (const path of ['/w', '/w/kls-vdit', '/workspaces']) expect(isWorkspacePath(path)).toBe(true)
    for (const path of ['/coach', '/welcome', '/workspaces-lookalike']) expect(isWorkspacePath(path)).toBe(false)
  })
  it('preserves the requested workspace without forcing a chooser', () => {
    expect(safeAppPath('/w/kls-vdit')).toBe('/w/kls-vdit')
    expect(safeAppPath('%2Fw%2Fkls-vdit')).toBe('/w/kls-vdit')
    expect(safeAppPath('/workspaces')).toBe('/workspaces')
    expect(safeAppPath('/coach')).toBe('/coach')
  })
  it('rejects lookalikes, external addresses and auth loops', () => {
    for (const path of ['//evil.test/w/kls-vdit', 'https://evil.test/w/kls-vdit', '/workspace-evil', '/welcome', '/auth/login?next=/w/kls-vdit']) expect(safeAppPath(path)).toBeNull()
  })
})
