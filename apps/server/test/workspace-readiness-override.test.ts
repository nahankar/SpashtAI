import { afterEach, describe, expect, it } from 'vitest'
import { WORKSPACE_FEATURE_READINESS, workspaceFeatureReady } from '../src/workspaces/productAccess'

describe('local workspace readiness override', () => {
  const env = { node: process.env.NODE_ENV, override: process.env.WORKSPACE_READY_OVERRIDE }
  afterEach(() => {
    process.env.NODE_ENV = env.node
    if (env.override === undefined) delete process.env.WORKSPACE_READY_OVERRIDE
    else process.env.WORKSPACE_READY_OVERRIDE = env.override
  })

  it('keeps unfinished products off unless a local override names them', () => {
    delete process.env.WORKSPACE_READY_OVERRIDE
    process.env.NODE_ENV = 'development'
    expect(workspaceFeatureReady('replay')).toBe(WORKSPACE_FEATURE_READINESS.replay)
    expect(workspaceFeatureReady('coach')).toBe(false)
    expect(workspaceFeatureReady('prepare')).toBe(false)
    process.env.WORKSPACE_READY_OVERRIDE = 'coach'
    expect(workspaceFeatureReady('coach')).toBe(true)
    expect(workspaceFeatureReady('prepare')).toBe(false)
  })

  it('is ignored in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.WORKSPACE_READY_OVERRIDE = 'replay,elevate,interviews,coach,prepare'
    expect(workspaceFeatureReady('replay')).toBe(WORKSPACE_FEATURE_READINESS.replay)
    expect(workspaceFeatureReady('elevate')).toBe(WORKSPACE_FEATURE_READINESS.elevate)
    expect(workspaceFeatureReady('coach')).toBe(false)
    expect(workspaceFeatureReady('prepare')).toBe(false)
    expect(workspaceFeatureReady('pro')).toBe(true)
  })
})
