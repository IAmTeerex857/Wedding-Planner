import { describe, expect, it } from 'vitest'
import { pillTone } from '../pills'

describe('pillTone', () => {
  it('uses semantic colors for known workflow values', () => {
    expect(pillTone('Attending')).toBe('pill-tone-success')
    expect(pillTone('Declined')).toBe('pill-tone-error')
    expect(pillTone('Pending')).toBe('pill-tone-warning')
    expect(pillTone('Scheduled')).toBe('pill-tone-info')
  })

  it('assigns the same color to repeated custom tags', () => {
    expect(pillTone('Family')).toBe(pillTone('Family'))
  })

  it('leaves labels that are not statuses neutral', () => {
    expect(pillTone('Family')).toBe('pill-tone-neutral')
    expect(pillTone('Hall')).toBe('pill-tone-neutral')
    expect(pillTone('Traditional')).toBe('pill-tone-neutral')
  })
})
