export interface GoogleButtonHandlers {
  onCredential: (credential: string) => Promise<void>
  onError: (message: string) => void
  setBusy: (busy: boolean) => void
}

let activeHandlers: GoogleButtonHandlers | null = null

/** GIS initializes once per document, while React replaces the button on route changes. */
export function activateGoogleButton(handlers: GoogleButtonHandlers) {
  activeHandlers = handlers
  return () => { if (activeHandlers === handlers) activeHandlers = null }
}

export async function dispatchGoogleCredential(response: { credential: string }) {
  const current = activeHandlers
  if (!current) return
  if (!response.credential) { current.onError('Google sign-in was cancelled'); return }
  current.setBusy(true)
  try { await current.onCredential(response.credential) }
  catch (err) { current.onError(err instanceof Error ? err.message : 'Google sign-in failed') }
  finally { current.setBusy(false) }
}
