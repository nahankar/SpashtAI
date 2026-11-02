import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { useFeatureFlags, WorkspaceFeatureFlagsProvider, type PlatformFeature } from './FeatureFlagsContext'

const FEATURES: PlatformFeature[] = ['elevate', 'replay', 'interviews', 'prepare', 'quick_try']

function Probe() {
  const { isAccessible, isVisible } = useFeatureFlags()
  return <>{FEATURES.map(f => `${f}:${isVisible(f) && isAccessible(f) ? 'on' : 'off'}`).join(' ')}</>
}

describe('workspace feature flags', () => {
  it('shows only products the member is allowed in this workspace', () => {
    const html = renderToStaticMarkup(
      <WorkspaceFeatureFlagsProvider allowed={{ elevate: true, replay: false, interviews: true, prepare: true, quick_try: true }}>
        <Probe />
      </WorkspaceFeatureFlagsProvider>,
    )
    expect(html).toBe('elevate:on replay:off interviews:on prepare:off quick_try:off')
  })

  it('treats a missing decision as not allowed', () => {
    expect(renderToStaticMarkup(<WorkspaceFeatureFlagsProvider allowed={{}}><Probe /></WorkspaceFeatureFlagsProvider>))
      .toBe('elevate:off replay:off interviews:off prepare:off quick_try:off')
  })
})
