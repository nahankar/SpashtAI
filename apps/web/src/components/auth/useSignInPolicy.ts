import { useEffect, useState } from 'react'
export type SignInMethods = { google: boolean; emailCode: boolean }
export function workspaceSlugFromNext(next: string | null) { return next?.match(/^\/w\/([a-z0-9-]+)(?:\/|$)/)?.[1] }
export function useSignInPolicy(slug?: string) {
  const [state, setState] = useState<{ methods: SignInMethods; loading: boolean; error: string; name?: string }>({ methods: { google: false, emailCode: false }, loading: true, error: '' })
  useEffect(() => {
    const controller = new AbortController()
    setState({ methods: { google: false, emailCode: false }, loading: true, error: '' })
    const api = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'
    fetch(`${api}/api/auth/sign-in-policy${slug ? `?workspace=${encodeURIComponent(slug)}` : ''}`, { signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Unable to load sign-in settings'); return data })
      .then(data => setState({ methods: data.methods, name: data.workspace?.name, loading: false, error: '' }))
      .catch(e => { if (!controller.signal.aborted) setState({ methods: { google: false, emailCode: false }, loading: false, error: e.message }) })
    return () => controller.abort()
  }, [slug])
  return state
}
