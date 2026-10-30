import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { readDemo, writeDemo, type DemoDataSource, type StoredDemo } from '@/lib/tenantDemo'

interface TenantDemoValue {
  enabled: boolean
  dataSource: DemoDataSource
  setEnabled: (on: boolean) => void
  setDataSource: (data: DemoDataSource) => void
}

const TenantDemoContext = createContext<TenantDemoValue>({
  enabled: false,
  dataSource: 'sample',
  setEnabled: () => {},
  setDataSource: () => {},
})

const off = (userId: string | undefined): StoredDemo => ({ userId: userId ?? '', on: false, data: 'sample' })

/** Tab-local Tenant Admin demo state for the signed-in Admin (see lib/tenantDemo). */
export function TenantDemoProvider({ userId, children }: { userId: string | undefined; children: ReactNode }) {
  const [stored, setStored] = useState<StoredDemo>(() => readDemo(userId) ?? off(userId))
  // A different signed-in user in this tab never inherits the previous user's demo setting.
  const state = stored.userId === userId ? stored : off(userId)

  const value = useMemo<TenantDemoValue>(() => {
    const save = (next: StoredDemo) => { setStored(next); writeDemo(next) }
    return {
      enabled: state.on,
      dataSource: state.data,
      // Turning the demo on always starts from labelled sample data.
      setEnabled: (on) => save({ ...state, on, data: on ? 'sample' : state.data }),
      setDataSource: (data) => save({ ...state, data }),
    }
  }, [state])

  return <TenantDemoContext.Provider value={value}>{children}</TenantDemoContext.Provider>
}

// The hook and provider share a private context and intentionally live together.
// eslint-disable-next-line react-refresh/only-export-components
export function useTenantDemo() {
  return useContext(TenantDemoContext)
}
