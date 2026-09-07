import { describe, expect, it } from 'vitest'
import { ceremonyIdForEvent, ceremonyLabel, relationOne, type CeremonyOption } from '../workspace-context'

const ceremonies: CeremonyOption[] = [
  { id: 'court-id', kind: 'court', name: 'Court Wedding' },
  { id: 'traditional-id', kind: 'traditional', name: 'Traditional Wedding' },
  { id: 'white-id', kind: 'white', name: 'White Wedding' },
  { id: 'nikah-id', kind: 'Nikah', name: 'Friday Nikah' },
]

describe('ceremony relationship mapping', () => {
  it('maps display labels to persistent ceremony IDs', () => {
    expect(ceremonyIdForEvent(ceremonies, 'Traditional')).toBe('traditional-id')
    expect(ceremonyIdForEvent(ceremonies, 'White Wedding')).toBe('white-id')
    expect(ceremonyIdForEvent(ceremonies, 'nikah-id')).toBe('nikah-id')
    expect(ceremonyIdForEvent(ceremonies, 'Friday Nikah')).toBe('nikah-id')
    expect(ceremonyIdForEvent(ceremonies, 'General / shared')).toBeNull()
  })

  it('supports PostgREST object and array relationship shapes', () => {
    expect(relationOne({ id: 'one' })).toEqual({ id: 'one' })
    expect(relationOne([{ id: 'one' }])).toEqual({ id: 'one' })
    expect(relationOne([])).toBeNull()
  })

  it('creates stable ceremony labels', () => {
    expect(ceremonyLabel(ceremonies[0])).toBe('Court')
    expect(ceremonyLabel(ceremonies[3])).toBe('Friday Nikah')
    expect(ceremonyLabel(null)).toBe('General / shared')
  })
})
