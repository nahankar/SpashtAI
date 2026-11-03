import { afterEach, describe, expect, it } from 'vitest'
import { WORKSPACE_FEATURE_READINESS, workspaceFeatureReady } from '../src/workspaces/productAccess'

describe('local workspace readiness override', () => {
  const env = { node: process.env.NODE_ENV, override: process.env.WORKSPACE_READY_OVERRIDE }
  afterEach(() => {
    process.env.NODE_ENV = env.node
    if (env.override === undefined) delete process.env.WORKSPACE_READY_OVERRIDE
    else process.env.WORKSPACE_READY_OVERRIDE = env.override
  })

  it('stays off unless a local override names the feature', () => {
    delete process.env.WORKSPACE_READY_OVERRIDE
    process.env.NODE_ENV = 'development'
    expect(workspaceFeatureReady('replay')).toBe(WORKSPACE_FEATURE_READINESS.replay)
    process.env.WORKSPACE_READY_OVERRIDE = 'replay'
    expect(workspaceFeatureReady('replay')).toBe(true)
    expect(workspaceFeatureReady('elevate')).toBe(false)
    expect(workspaceFeatureReady('coach')).toBe(false)
  })

  it('is ignored in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.WORKSPACE_READY_OVERRIDE = 'replay,elevate,interviews,coach,prepare'
    expect(workspaceFeatureReady('replay')).toBe(false)
    expect(workspaceFeatureReady('elevate')).toBe(false)
    expect(workspaceFeatureReady('pro')).toBe(true)
  })
})
