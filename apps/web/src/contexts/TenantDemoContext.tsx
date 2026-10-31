import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { readDemo, writeDemo, type StoredDemo } from '@/lib/tenantDemo'

interface TenantDemoValue {
  enabled: boolean
  setEnabled: (on: boolean) => void
}

const TenantDemoContext = createContext<TenantDemoValue>({ enabled: false, setEnabled: () => {} })

const off = (userId: string | undefined): StoredDemo => ({ userId: userId ?? '', on: false })

/** Tab-local Tenant Admin demo state for the signed-in Admin (see lib/tenantDemo). */
export function TenantDemoProvider({ userId, children }: { userId: string | undefined; children: ReactNode }) {
  const [stored, setStored] = useState<StoredDemo>(() => readDemo(userId) ?? off(userId))
  // A different signed-in user in this tab never inherits the previous user's demo setting.
  const enabled = stored.userId === userId && stored.on

  const value = useMemo<TenantDemoValue>(() => ({
    enabled,
    setEnabled: (on) => {
      const next = { userId: userId ?? '', on }
      setStored(next)
      writeDemo(next)
    },
  }), [enabled, userId])

  return <TenantDemoContext.Provider value={value}>{children}</TenantDemoContext.Provider>
}

// The hook and provider share a private context and intentionally live together.
// eslint-disable-next-line react-refresh/only-export-components
export function useTenantDemo() {
  return useContext(TenantDemoContext)
}
