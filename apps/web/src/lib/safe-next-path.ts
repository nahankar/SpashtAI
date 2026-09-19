const ALLOWED_PREFIXES = [
  '/',
  '/coach',
  '/elevate',
  '/prepare',
  '/replay',
  '/progress',
  '/history',
  '/feedback',
]

/** Relative in-app path only. Blocks open redirects and auth loops. */
export function safeAppPath(value: string | null | undefined): string | null {
  if (!value) return null
  let path = value.trim()
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return null
  if (path.startsWith('/auth')) return null
  const pathname = path.split('?')[0] || '/'
  const allowed = ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || (prefix !== '/' && pathname.startsWith(`${prefix}/`)),
  )
  return allowed ? path : null
}
