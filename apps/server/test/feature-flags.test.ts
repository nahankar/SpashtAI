import { describe, expect, it } from 'vitest'
import {
  CONFIGURABLE_FEATURES,
  PLATFORM_FEATURES,
  type ConfigurableFeature,
} from '../src/lib/featureFlags'

describe('feature flag registry', () => {
  it('exposes Delivery Moments to Admin without treating it as a navigation module', () => {
    expect(CONFIGURABLE_FEATURES).toContain('delivery_moments')
    expect(PLATFORM_FEATURES).not.toContain('delivery_moments')
    const feature: ConfigurableFeature = 'delivery_moments'
    expect(feature).toBe('delivery_moments')
  })
})
