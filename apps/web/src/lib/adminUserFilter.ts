export interface SessionOwner {
  id?: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}

export function formatSessionOwner(owner: SessionOwner | null | undefined): string {
  const fullName = [owner?.firstName, owner?.lastName].filter(Boolean).join(' ').trim()
  return fullName || owner?.email || 'Unknown user'
}

export function matchesSessionOwner(
  owner: SessionOwner | null | undefined,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  const searchable = [
    owner?.firstName,
    owner?.lastName,
    [owner?.firstName, owner?.lastName].filter(Boolean).join(' '),
    owner?.email,
  ]
  return searchable.some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
}
