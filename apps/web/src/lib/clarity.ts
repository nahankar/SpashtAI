export const CLARITY_CONSENT_KEY = 'spashtai_analytics_consent'

type ClarityConsent = 'granted' | 'denied'

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[] }

declare global {
  interface Window {
    clarity?: ClarityFn
  }
}

export function readClarityConsent(): ClarityConsent | null {
  try {
    const value = localStorage.getItem(CLARITY_CONSENT_KEY)
    return value === 'granted' || value === 'denied' ? value : null
  } catch {
    return null
  }
}

export function writeClarityConsent(value: ClarityConsent) {
  localStorage.setItem(CLARITY_CONSENT_KEY, value)
}

export function clarityProjectId() {
  return import.meta.env.VITE_CLARITY_PROJECT_ID || ''
}

export function clarityDashboardUrl() {
  const configured = import.meta.env.VITE_CLARITY_DASHBOARD_URL || ''
  if (configured) return configured
  const projectId = clarityProjectId()
  return projectId ? `https://clarity.microsoft.com/projects/view/${encodeURIComponent(projectId)}/dashboard` : ''
}

export function canUseClarity(pathname: string) {
  return import.meta.env.PROD && Boolean(clarityProjectId()) && !pathname.startsWith('/admin') && readClarityConsent() === 'granted'
}

export function loadClarity(projectId: string) {
  if (typeof window === 'undefined' || document.getElementById('microsoft-clarity')) return
  window.clarity = window.clarity || function clarityQueue(...args: unknown[]) {
    ;(window.clarity!.q = window.clarity!.q || []).push(args)
  }
  const script = document.createElement('script')
  script.id = 'microsoft-clarity'
  script.async = true
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(projectId)}`
  document.head.appendChild(script)
}

export function tagClarity(userId: string, pathname: string) {
  const feature = pathname.startsWith('/replay') ? 'replay'
    : pathname.startsWith('/elevate') ? 'elevate'
    : pathname.startsWith('/interviews') ? 'interviews'
    : pathname.startsWith('/prepare') ? 'prepare'
    : pathname.startsWith('/progress') ? 'progress_pulse'
    : pathname.startsWith('/feedback') ? 'feedback'
    : 'app'
  window.clarity?.('identify', userId)
  window.clarity?.('set', 'feature', feature)
}
