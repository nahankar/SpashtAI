import { describe, expect, it } from 'vitest'
import { ownerListWhere } from '../src/lib/listAccess'

describe('owner-scoped product lists', () => {
  it('limits normal users to their own records', () => {
    expect(ownerListWhere('user-1', 'USER')).toEqual({ userId: 'user-1' })
  })

  it('allows admins and super admins to list records across users', () => {
    expect(ownerListWhere('admin-1', 'ADMIN')).toEqual({})
    expect(ownerListWhere('admin-1', 'SUPER_ADMIN')).toEqual({})
  })
})
