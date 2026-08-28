import { describe, expect, it } from 'vitest'
import { pillTone } from '../pills'

describe('pillTone', () => {
  it('uses semantic colors for known workflow values', () => {
    expect(pillTone('Attending')).toBe('pill-tone-green')
    expect(pillTone('Declined')).toBe('pill-tone-red')
    expect(pillTone('Pending')).toBe('pill-tone-yellow')
  })

  it('assigns the same color to repeated custom tags', () => {
    expect(pillTone('Family')).toBe(pillTone('Family'))
  })
})
