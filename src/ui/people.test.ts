// Avatar initials as drawn in the mockups: Approver 01 is "P1", so it doesn't clash with Author 01.
import { describe, expect, it } from 'vitest'
import { initials } from './people'

describe('initials', () => {
  it('uses the role letter from the mockups and the account number', () => {
    expect(initials('Approver 01')).toBe('P1')
    expect(initials('Author 01')).toBe('A1')
    expect(initials('Reviewer 03')).toBe('R3')
    expect(initials('Ada Lovelace')).toBe('AL')
  })
})
