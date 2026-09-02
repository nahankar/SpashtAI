import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import '@livekit/components-styles'
import { Toaster } from 'sonner'
import { ConfirmProvider } from '@/hooks/useConfirm'
import { initRemoteLogger } from '@/lib/remoteLogger'

// Operational logging only; no-op unless enabled. Must run before render so it
// captures early errors. Wrapped internally — never throws.
initRemoteLogger()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
      <Toaster richColors closeButton />
    </ConfirmProvider>
  </StrictMode>,
)
