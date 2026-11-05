import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuthContext, type AuthContextType, type AuthUser } from '@/contexts/AuthContext'
import { WorkspaceShellContext, type WorkspaceShellValue } from '@/workspaces/shell/context'
import { useCanReplayAudioUpload } from './useCanReplayAudioUpload'

function Probe() {
  return <>{useCanReplayAudioUpload() ? 'on' : 'off'}</>
}

function unused(): never {
  throw new Error('unused')
}

function auth(user: Partial<AuthUser> = {}): AuthContextType {
  return {
    user: {
      id: 'u1',
      email: 'learner@walkthrough.test',
      firstName: 'LEARNER',
      lastName: 'One',
      avatar: null,
      role: 'USER',
      emailVerified: true,
      lastLoginAt: null,
      createdAt: '2026-11-03',
      enableReplayAudioUpload: false,
      ...user,
    },
    loading: false,
    login: unused,
    loginForDevelopment: unused,
    loginWithGoogle: unused,
    loginWithEmailCode: unused,
    register: unused,
    logout: () => {},
    isAdmin: false,
    updateUser: () => {},
    fetchCurrentUser: async () => {},
  }
}

function shell(allowed: Record<string, boolean>): WorkspaceShellValue {
  return {
    slug: 'northwind',
    entry: {} as WorkspaceShellValue['entry'],
    snapshot: {
      workspace: { id: 'ws', slug: 'northwind' } as WorkspaceShellValue['snapshot']['workspace'],
      membership: { id: 'm', role: 'LEARNER', state: 'ACTIVE' },
      notice: '',
      counts: null,
      features: Object.entries(allowed).map(([feature, value]) => ({
        feature, entitled: value, enabled: value, memberDefault: value, allowed: value, ready: true,
      })),
    },
    reload: async () => {},
  }
}

describe('useCanReplayAudioUpload', () => {
  it('uses the workspace plan, not the Personal preview flag', () => {
    expect(renderToStaticMarkup(
      <AuthContext.Provider value={auth({ enableReplayAudioUpload: true })}>
        <WorkspaceShellContext.Provider value={shell({ replay: true, pro: false })}>
          <Probe />
        </WorkspaceShellContext.Provider>
      </AuthContext.Provider>,
    )).toBe('off')
    expect(renderToStaticMarkup(
      <AuthContext.Provider value={auth({ enableReplayAudioUpload: false })}>
        <WorkspaceShellContext.Provider value={shell({ replay: true, pro: true })}>
          <Probe />
        </WorkspaceShellContext.Provider>
      </AuthContext.Provider>,
    )).toBe('on')
  })

  it('keeps the Personal preview flag outside a workspace', () => {
    expect(renderToStaticMarkup(
      <AuthContext.Provider value={auth({ enableReplayAudioUpload: false })}><Probe /></AuthContext.Provider>,
    )).toBe('off')
    expect(renderToStaticMarkup(
      <AuthContext.Provider value={auth({ enableReplayAudioUpload: true })}><Probe /></AuthContext.Provider>,
    )).toBe('on')
  })
})
