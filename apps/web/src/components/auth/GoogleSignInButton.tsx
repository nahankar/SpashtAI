import { activateGoogleButton, dispatchGoogleCredential, type GoogleButtonHandlers } from './googleIdentityCallback'
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || ''

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
            auto_select?: boolean
          }) => void
          renderButton: (
            element: HTMLElement,
            config: Record<string, string>,
          ) => void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | null = null
let gsiInitialized = false

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Sign-In'))
    document.head.appendChild(script)
  })

  return scriptPromise
}

export function GoogleSignInButton({
  label,
  onCredential,
  onError,
}: {
  label: 'signup_with' | 'signin_with'
  onCredential: (credential: string) => Promise<void>
  onError: (message: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onCredentialRef = useRef(onCredential)
  const onErrorRef = useRef(onError)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  onCredentialRef.current = onCredential
  onErrorRef.current = onError

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return

    let cancelled = false
    let deactivate: (() => void) | undefined
    const handlers: GoogleButtonHandlers = {
      onCredential: credential => onCredentialRef.current(credential),
      onError: message => onErrorRef.current(message),
      setBusy,
    }

    loadGoogleScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google?.accounts?.id) return

        deactivate = activateGoogleButton(handlers)
        if (!gsiInitialized) {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: dispatchGoogleCredential,
          })
          gsiInitialized = true
        }

        containerRef.current.innerHTML = ''
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: label,
          width: '360',
          shape: 'rectangular',
        })
        setReady(true)
      })
      .catch(() => onErrorRef.current('Could not load Google Sign-In'))

    return () => {
      cancelled = true
      deactivate?.()
    }
  }, [label])

  if (!GOOGLE_CLIENT_ID) {
    return (
      <Button type="button" variant="outline" className="w-full" disabled title="Set VITE_GOOGLE_CLIENT_ID">
        Google sign-in is not configured
      </Button>
    )
  }

  return (
    <div className="w-full flex flex-col items-center gap-2">
      {!ready && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Google…
        </div>
      )}
      <div ref={containerRef} className={ready ? 'w-full flex justify-center' : 'hidden'} />
      {busy && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Signing in…
        </div>
      )}
    </div>
  )
}
