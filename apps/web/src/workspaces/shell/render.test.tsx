import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Feature, Membership, Snapshot } from '../client'
import { FeaturesCard } from '../admin/SettingsPage'
import { DailyActivityView, OverviewView, ProgressPulseView } from '../admin/reports'
import { WorkspaceShellContext } from './context'
import { WorkspaceHome } from './WorkspaceShell'

const workspace = { id: 'ws-1', slug: 'klsvdit', name: 'KLS VDIT', kind: 'ORGANIZATION' as const, state: 'ACTIVE' as const, logoDataUrl: null, accentColor: '#123456', timeZone: 'Asia/Kolkata', isolationStage: 'PRODUCT_PLANE', limits: { maxMembers: 10, dailyEvaluations: 5, concurrentVoice: 2 } }
const feature = (name: string, change: Partial<Feature> = {}): Feature => ({ feature: name, entitled: true, enabled: true, memberDefault: true, allowed: true, ready: true, ...change })
const range = { from: '2026-11-01', to: '2026-11-02', timeZone: 'Asia/Kolkata', learner: null, product: null, skill: null }

function home(role: Membership['role'], features: Feature[]) {
  const snapshot: Snapshot = { workspace, membership: { id: 'm-1', role, state: 'ACTIVE' }, notice: 'Workspace records stay here.', counts: null, features }
  return renderToStaticMarkup(<MemoryRouter><WorkspaceShellContext.Provider value={{ slug: 'klsvdit', entry: { ...snapshot, accessToken: 't' }, snapshot, reload: async () => {} }}>
    <WorkspaceHome /></WorkspaceShellContext.Provider></MemoryRouter>)
}

describe('workspace pages', () => {
  it('shows learners their allowed products under the workspace address and no administration', () => {
    const html = home('LEARNER', [feature('elevate'), feature('replay', { allowed: false }), feature('interviews')])
    expect(html).toContain('href="/w/klsvdit/elevate"'); expect(html).toContain('href="/w/klsvdit/interviews"')
    expect(html).not.toContain('/w/klsvdit/replay'); expect(html).not.toContain('Open dashboard')
  })

  it('shows Admins the dashboard entry even before any product is turned on', () => {
    const html = home('ADMIN', [])
    expect(html).toContain('href="/w/klsvdit/admin"'); expect(html).toContain('No products yet')
  })

  it('lets administrators switch only products in the plan, and marks unfinished ones', () => {
    const html = renderToStaticMarkup(<FeaturesCard busy={false} onSave={() => {}} features={[feature('replay', { ready: false }), feature('coach', { entitled: false, enabled: false })]} />)
    expect(html).toContain('Not yet available')
    expect(html.match(/role="switch"[^>]*disabled=""/g)).toHaveLength(2)
    expect(html).not.toMatch(/<input[^>]*type="checkbox"(?![^>]*aria-hidden)/)
  })

  it('reads empty periods as empty, not as missing data', () => {
    const days = [{ day: '2026-11-01', activeLearners: 0, elevate: 0, replay: 0, interviews: 0, practiceMinutes: 0 }]
    expect(renderToStaticMarkup(<DailyActivityView data={{ range, days }} />)).toContain('No practice in this period')
    expect(renderToStaticMarkup(<ProgressPulseView data={{ range, skills: [], days: [{ day: '2026-11-01', average: null, samples: 0 }], learners: [] }} />)).toContain('No Progress Pulse scores')
    const overview = renderToStaticMarkup(<OverviewView data={{ range, members: { active: 3, invited: 1, suspended: 0, seats: 10 }, activeLearners: 0, activity: {}, evaluations: { day: '2026-11-02', used: 2, limit: 5 }, voice: { inUse: 1, limit: 2 } }} />)
    expect(overview).toContain('3 / 10'); expect(overview).toContain('2 / 5'); expect(overview).toContain('1 / 2')
  })
})
