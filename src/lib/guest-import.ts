export const GUEST_IMPORT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'plusOneName',
  'tags',
  'accommodation',
  'courtRsvp',
  'traditionalRsvp',
  'whiteRsvp',
] as const

export type GuestImportField = (typeof GUEST_IMPORT_FIELDS)[number]
export type RsvpStatus = 'pending' | 'attending' | 'declined'

export type ImportableGuest = {
  firstName: string
  lastName: string
  email: string
  phone: string
  plusOneAllowed: boolean
  plusOneName: string
  tags: string[]
  accommodation: string
  rsvps: Record<'court' | 'traditional' | 'white', RsvpStatus>
}

export type ParsedGuestData = {
  headers: string[]
  rows: Record<string, string>[]
}

export type GuestFieldMapping = Partial<Record<GuestImportField, string>>

export type GuestImportReviewRow = {
  sourceIndex: number
  source: Record<string, string>
  guest: ImportableGuest
  status: 'ready' | 'duplicate' | 'invalid'
  reason?: string
}

export type DuplicateGuest = Pick<ImportableGuest, 'email' | 'phone'>

const HEADER_ALIASES: Record<GuestImportField, string[]> = {
  firstName: ['first name', 'firstname', 'given name', 'givenname', 'first'],
  lastName: ['last name', 'lastname', 'surname', 'family name', 'familyname', 'last'],
  email: ['email', 'email address', 'e-mail'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone'],
  plusOneName: ['plus one', 'plus one name', 'plus-one', 'guest of guest'],
  tags: ['tags', 'tag', 'group', 'groups', 'category'],
  accommodation: ['accommodation', 'hotel', 'lodging', 'stay'],
  courtRsvp: ['court rsvp', 'court status', 'court'],
  traditionalRsvp: ['traditional rsvp', 'traditional status', 'traditional'],
  whiteRsvp: ['white rsvp', 'white status', 'white wedding rsvp', 'white'],
}

export function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function normalizePhone(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''
  if (trimmed.startsWith('+')) return `+${digits}`
  if (digits.startsWith('00')) return `+${digits.slice(2)}`
  return digits
}

export function parseGuestData(input: string): ParsedGuestData {
  const normalized = input.replace(/^\uFEFF/, '').trim()
  if (!normalized) return { headers: [], rows: [] }

  const firstLine = normalized.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = firstLine.includes('\t') ? '\t' : ','
  const matrix = parseDelimitedRows(normalized, delimiter)
  const rawHeaders = matrix.shift() ?? []
  const headers = uniqueHeaders(rawHeaders.map((header, index) => header.trim() || `Column ${index + 1}`))

  return {
    headers,
    rows: matrix
      .filter((row) => row.some((cell) => cell.trim()))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? '']))),
  }
}

export async function parseGuestWorkbook(file: File): Promise<ParsedGuestData> {
  return (await parseGuestWorkbookSheets(file))[0]?.data ?? { headers: [], rows: [] }
}

export async function parseGuestWorkbookSheets(file: File): Promise<Array<{ name: string; data: ParsedGuestData }>> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date>>(sheet, { header: 1, raw: false, defval: '' })
    const rawHeaders = matrix.shift() ?? []
    const headers = uniqueHeaders(rawHeaders.map((value, index) => String(value).trim() || `Column ${index + 1}`))
    return { name, data: { headers, rows: matrix.filter((row) => row.some((cell) => String(cell).trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim()]))) } }
  })
}

export function suggestGuestFieldMapping(headers: string[]): GuestFieldMapping {
  const mapping: GuestFieldMapping = {}
  const normalizedHeaders = headers.map((header) => normalizeHeader(header))

  for (const field of GUEST_IMPORT_FIELDS) {
    const aliases = HEADER_ALIASES[field]
    const headerIndex = normalizedHeaders.findIndex((header) => aliases.includes(header))
    if (headerIndex >= 0) mapping[field] = headers[headerIndex]
  }

  return mapping
}

export function buildGuestImportReview(
  rows: Record<string, string>[],
  mapping: GuestFieldMapping,
  existingGuests: DuplicateGuest[],
): GuestImportReviewRow[] {
  const knownEmails = new Set(existingGuests.map((guest) => normalizeEmail(guest.email)).filter(Boolean))
  const knownPhones = new Set(existingGuests.map((guest) => normalizePhone(guest.phone)).filter(Boolean))

  return rows.map((source, index) => {
    const guest = mapGuest(source, mapping)
    const email = guest.email
    const phone = guest.phone
    let status: GuestImportReviewRow['status'] = 'ready'
    let reason: string | undefined

    if (!guest.firstName && !guest.lastName) {
      status = 'invalid'
      reason = 'A first or last name is required'
    } else if (!email && !phone) {
      status = 'invalid'
      reason = 'An email or phone number is required'
    } else if (email && knownEmails.has(email)) {
      status = 'duplicate'
      reason = 'Email already appears in the guest list or this import'
    } else if (phone && knownPhones.has(phone)) {
      status = 'duplicate'
      reason = 'Phone already appears in the guest list or this import'
    }

    if (status === 'ready') {
      if (email) knownEmails.add(email)
      if (phone) knownPhones.add(phone)
    }

    return { sourceIndex: index + 1, source, guest, status, reason }
  })
}

function mapGuest(source: Record<string, string>, mapping: GuestFieldMapping): ImportableGuest {
  const value = (field: GuestImportField) => {
    const header = mapping[field]
    return header ? source[header]?.trim() ?? '' : ''
  }

  return {
    firstName: value('firstName'),
    lastName: value('lastName'),
    email: normalizeEmail(value('email')),
    phone: normalizePhone(value('phone')),
    plusOneAllowed: Boolean(value('plusOneName')),
    plusOneName: value('plusOneName'),
    tags: value('tags').split(/[;,|]/).map((tag) => tag.trim()).filter(Boolean),
    accommodation: value('accommodation'),
    rsvps: {
      court: normalizeRsvp(value('courtRsvp')),
      traditional: normalizeRsvp(value('traditionalRsvp')),
      white: normalizeRsvp(value('whiteRsvp')),
    },
  }
}

function normalizeRsvp(value: string): RsvpStatus {
  const normalized = value.trim().toLocaleLowerCase()
  if (['yes', 'y', 'attending', 'accepted', 'confirmed'].includes(normalized)) return 'attending'
  if (['no', 'n', 'declined', 'not attending'].includes(normalized)) return 'declined'
  return 'pending'
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function uniqueHeaders(headers: string[]): string[] {
  const used = new Map<string, number>()
  return headers.map((header) => {
    const count = used.get(header) ?? 0
    used.set(header, count + 1)
    return count === 0 ? header : `${header} ${count + 1}`
  })
}

function parseDelimitedRows(input: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    const next = input[index + 1]

    if (character === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === delimiter && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }

  row.push(cell)
  rows.push(row)
  return rows
}
