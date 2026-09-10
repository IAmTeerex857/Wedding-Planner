import { describe, expect, it } from 'vitest'
import { normalizeFoodDrinkPayload } from '../server'

describe('normalizeFoodDrinkPayload', () => {
  it('normalizes an image-derived drink proposal for execution', () => {
    expect(normalizeFoodDrinkPayload({
      name: 'Wine pack',
      ceremony_id: '7ca32410-9453-4930-bcc3-292159b313ed',
      service_type: 'drink',
      currency: 'NGN',
      quantity: 'Approximately 12 bottles',
      supplier: 'Unspecified',
      supply_status: 'Promised',
      bartender_status: 'Not yet arranged',
      estimated_cost_minor: 20_000_000,
    })).toEqual({
      name: 'Wine pack',
      ceremony_id: '7ca32410-9453-4930-bcc3-292159b313ed',
      service_type: 'bartender',
      vendor_id: null,
      package_name: null,
      package_price_minor: 20_000_000,
      currency: 'NGN',
      guest_count: null,
      status: 'option',
      notes: 'Quantity: Approximately 12 bottles · Supply status: Promised · Bartender: Not yet arranged',
    })
  })

  it('rejects unsupported service types before approval', () => {
    expect(() => normalizeFoodDrinkPayload({
      name: 'Wine pack',
      ceremony_id: '7ca32410-9453-4930-bcc3-292159b313ed',
      service_type: 'unknown',
    })).toThrow('Food and drink service_type must be caterer, bartender, combined, or self_managed')
  })
})
