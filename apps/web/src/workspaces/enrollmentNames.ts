import type { EnrollmentField } from './EnrollmentFields'

/** Match the legacy custom questions that supply the account's name at signup. */
export function enrollmentNameKey(field: EnrollmentField): 'firstName' | 'lastName' | null {
  if (field.type !== 'text') return null
  const normalized = [field.id, field.label].map(value => value.toLowerCase().replace(/[^a-z]/g, ''))
  return normalized.includes('firstname') ? 'firstName' : normalized.includes('lastname') ? 'lastName' : null
}
