import { describe, expect, it } from 'vitest'
import { buildGuestImportReview, normalizeEmail, normalizePhone, parseGuestData, suggestGuestFieldMapping } from '../guest-import'

describe('guest import parsing', () => {
  it('parses quoted CSV values and suggests common fields', () => {
    const parsed = parseGuestData('First Name,Last Name,Email,Tags\nAda,Okoye,ADA@example.com,"Family, VIP"')
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].Tags).toBe('Family, VIP')
    expect(suggestGuestFieldMapping(parsed.headers)).toMatchObject({ firstName: 'First Name', lastName: 'Last Name', email: 'Email', tags: 'Tags' })
  })

  it('parses spreadsheet tab-separated rows', () => {
    const parsed = parseGuestData('First name\tPhone\nAda\t+234 800 000 0000')
    expect(parsed.rows[0].Phone).toBe('+234 800 000 0000')
  })
})

describe('guest matching', () => {
  it('normalizes email and international phone values', () => {
    expect(normalizeEmail('  ADA@Example.COM ')).toBe('ada@example.com')
    expect(normalizePhone('00 234 800-000-0000')).toBe('+2348000000000')
  })

  it('skips duplicate email before considering phone', () => {
    const rows = [{ Name: 'Ada Okoye', Email: 'ada@example.com', Phone: '+2348111111111' }]
    const review = buildGuestImportReview(rows, { firstName: 'Name', email: 'Email', phone: 'Phone' }, [{ email: 'ada@example.com', phone: '+2348222222222' }])
    expect(review[0].status).toBe('duplicate')
    expect(review[0].reason).toContain('Email')
  })

  it('detects duplicate rows within one import', () => {
    const rows = [
      { Name: 'First Guest', Phone: '+2348000000000' },
      { Name: 'Second Guest', Phone: '+234 800 000 0000' },
    ]
    const review = buildGuestImportReview(rows, { firstName: 'Name', phone: 'Phone' }, [])
    expect(review.map((row) => row.status)).toEqual(['ready', 'duplicate'])
  })
})
