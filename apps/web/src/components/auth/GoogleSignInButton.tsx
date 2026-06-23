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
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return

    let cancelled = false

    loadGoogleScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google?.accounts?.id) return

        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => {
            if (!response.credential) {
              onError('Google sign-in was cancelled')
              return
            }
            setBusy(true)
            try {
              await onCredential(response.credential)
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Google sign-in failed')
            } finally {
              setBusy(false)
            }
          },
        })

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
      .catch(() => onError('Could not load Google Sign-In'))

    return () => {
      cancelled = true
    }
  }, [label, onCredential, onError])

  if (!GOOGLE_CLIENT_ID) {
    return (
      <Button type="button" variant="outline" className="w-full" disabled title="Set VITE_GOOGLE_CLIENT_ID">
        Continue with Google (not configured)
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
