import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { Login } from './Login'

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({}) }))
vi.mock('@/components/auth/GoogleSignInButton', () => ({
  GoogleSignInButton: () => <button>Continue with Google</button>,
}))

describe('sign-in methods', () => {
  it('places Google first, with email sign-in below and a Signup destination preserving next', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/auth/login?next=%2Fworkspaces']}><Login /></MemoryRouter>)
    expect(html).toContain('Continue with Google')
    expect(html).toContain('Or sign in with email')
    expect(html).toContain('Email address')
    expect(html.indexOf('Continue with Google')).toBeLessThan(html.indexOf('Email address'))
    expect(html.indexOf('Or sign in with email')).toBeLessThan(html.indexOf('Email address'))
    expect(html).toContain('/auth/register?next=%2Fworkspaces')
    expect(html).toContain('Email me a sign-in code')
  })
})
