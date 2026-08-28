import { requireSupabase } from './supabase'
import { ceremonyIdForEvent, ceremonyLabel, type CeremonyOption } from './workspace-context'

export type RegistryTitle = 'Calendar' | 'Itineraries' | 'Vendors' | 'Venues' | 'Food & drinks' | 'Wedding party' | 'Packing' | 'Gifts' | 'Honeymoon'
export type RegistryRecord = { id: string; values: Record<string, string>; status: string }

type Context = { workspaceId: string; userId: string; currency: string; ceremonies: CeremonyOption[] }
type RelatedCeremony = { kind: string; name: string }

const STATUS_MARKER = /^Registry status: ([^\n]+)\n?/i

const statusMaps: Record<RegistryTitle, Record<string, string>> = {
  Calendar: { Scheduled: 'scheduled', Complete: 'complete', Cancelled: 'cancelled' },
  Itineraries: { Planned: 'planned', Confirmed: 'confirmed', Complete: 'completed' },
  Vendors: { Considering: 'researching', Shortlisted: 'shortlisted', Selected: 'selected', Declined: 'rejected' },
  Venues: { Considering: 'researching', 'Viewing booked': 'shortlisted', Shortlisted: 'shortlisted', Selected: 'selected' },
  'Food & drinks': { Idea: 'option', Tasting: 'shortlisted', Approved: 'selected', Ordered: 'selected' },
  'Wedding party': { Invited: 'invited', Confirmed: 'confirmed', Ready: 'ready' },
  Packing: { 'Not packed': 'false', Packed: 'true' },
  Gifts: { Received: 'pending', 'Thank-you due': 'written', 'Thank-you sent': 'sent' },
  Honeymoon: { Researching: 'planned', Reserved: 'reserved', Paid: 'confirmed', Complete: 'completed' },
}

function displayStatus(title: RegistryTitle, value: string | boolean | null | undefined) {
  const stored = String(value ?? '')
  return Object.entries(statusMaps[title]).find(([, mapped]) => mapped === stored)?.[0] ?? Object.keys(statusMaps[title])[0]
}

function statusFromNotes(title: RegistryTitle, notes: string | null | undefined, fallback: string | boolean | null | undefined) {
  const marked = notes?.match(STATUS_MARKER)?.[1]
  return marked && Object.values(statusMaps[title]).includes(marked) ? displayStatus(title, marked) : marked && Object.keys(statusMaps[title]).includes(marked) ? marked : displayStatus(title, fallback)
}

function relation(value: unknown): RelatedCeremony | null {
  const item = Array.isArray(value) ? value[0] : value
  return item && typeof item === 'object' ? item as RelatedCeremony : null
}

function linkedCeremony(value: unknown, key: string) {
  const link = Array.isArray(value) ? value[0] : null
  if (!link || typeof link !== 'object') return null
  return relation((link as Record<string, unknown>)[key])
}

function toMinor(value?: string) {
  if (!value) return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null
}

function lagosIso(date?: string, time?: string) {
  if (!date) return null
  return new Date(`${date}T${time || '00:00'}:00+01:00`).toISOString()
}

function lagosParts(value?: string | null) {
  if (!value) return { date: '', time: '' }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

function eventOf(value: unknown) {
  return ceremonyLabel(relation(value))
}

function requireCeremony(context: Context, event?: string) {
  const id = ceremonyIdForEvent(context.ceremonies, event)
  if (!id) throw new Error('Choose an available ceremony for this record.')
  return id
}

function audit(context: Context) {
  return { workspace_id: context.workspaceId, created_by: context.userId, updated_by: context.userId }
}

async function moneyDetails(context: Context, amountMinor: number | null, currency: string) {
  if (amountMinor === null) return {}
  if (currency === 'NGN') return { exchange_rate: 1, rate_source: 'native', rate_retrieved_at: new Date().toISOString(), ngn_minor: amountMinor }
  const { data, error } = await requireSupabase().from('exchange_rates').select('rate,source,retrieved_at').eq('workspace_id', context.workspaceId).eq('base_currency', currency).eq('quote_currency', 'NGN').is('deleted_at', null).order('rate_date', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Add a ${currency} to NGN exchange rate before saving this amount.`)
  return { exchange_rate: Number(data.rate), rate_source: data.source, rate_retrieved_at: data.retrieved_at, ngn_minor: Math.round(amountMinor * Number(data.rate)) }
}

export async function loadCeremonies(workspaceId: string): Promise<CeremonyOption[]> {
  const { data, error } = await requireSupabase().from('ceremonies').select('id,kind,name').eq('workspace_id', workspaceId).is('deleted_at', null).order('kind')
  if (error) throw error
  return data
}

export async function loadRegistry(title: RegistryTitle, workspaceId: string): Promise<RegistryRecord[]> {
  const db = requireSupabase()
  if (title === 'Calendar') {
    const { data, error } = await db.from('calendar_entries').select('id,title,entry_type,starts_at,all_day,notes,ceremonies(kind,name)').eq('workspace_id', workspaceId).is('deleted_at', null).order('starts_at')
    if (error) throw error
    return data.map((row) => { const when = lagosParts(row.starts_at); return { id: row.id, values: { title: row.title, date: when.date, time: row.all_day ? '' : when.time, type: ({ task: 'Task', vendor_appointment: 'Appointment', payment: 'Payment', custom: 'Personal' } as Record<string, string>)[row.entry_type] ?? 'Personal', event: eventOf(row.ceremonies) }, status: statusFromNotes(title, row.notes, 'scheduled') } })
  }
  if (title === 'Itineraries') {
    const { data, error } = await db.from('itinerary_items').select('id,title,starts_at,location,responsible_person,status,ceremonies(kind,name)').eq('workspace_id', workspaceId).is('deleted_at', null).order('starts_at')
    if (error) throw error
    return data.map((row) => { const when = lagosParts(row.starts_at); return { id: row.id, values: { activity: row.title, date: when.date, time: when.time, location: row.location ?? '', owner: row.responsible_person ?? '', event: eventOf(row.ceremonies) }, status: displayStatus(title, row.status) } })
  }
  if (title === 'Vendors') {
    const { data, error } = await db.from('vendors').select('id,name,category,website,package_details,selection_status,vendor_contacts(name,phone,is_primary,deleted_at),vendor_ceremonies(ceremonies(kind,name))').eq('workspace_id', workspaceId).is('deleted_at', null).order('created_at', { ascending: false })
    if (error) throw error
    return data.map((row) => { const contacts = (row.vendor_contacts ?? []).filter((item) => !item.deleted_at) as Array<{ name: string; phone: string | null; is_primary: boolean }>; const contact = contacts.find((item) => item.is_primary) ?? contacts[0]; return { id: row.id, values: { name: row.name, category: row.category, link: row.website ?? '', contact: contact?.name ?? '', phone: contact?.phone ?? '', quote: row.package_details ?? '', event: ceremonyLabel(linkedCeremony(row.vendor_ceremonies, 'ceremonies')) }, status: displayStatus(title, row.selection_status) } })
  }
  if (title === 'Venues') {
    const { data, error } = await db.from('venues').select('id,name,address,capacity,ceremony_fee_minor,availability_notes,selection_status,notes,venue_ceremonies(ceremonies(kind,name))').eq('workspace_id', workspaceId).is('deleted_at', null).order('created_at', { ascending: false })
    if (error) throw error
    return data.map((row) => ({ id: row.id, values: { name: row.name, location: row.address ?? '', capacity: row.capacity?.toString() ?? '', cost: row.ceremony_fee_minor == null ? '' : String(row.ceremony_fee_minor / 100), availability: row.availability_notes ?? '', event: ceremonyLabel(linkedCeremony(row.venue_ceremonies, 'ceremonies')) }, status: statusFromNotes(title, row.notes, row.selection_status) }))
  }
  if (title === 'Food & drinks') {
    const { data, error } = await db.from('food_drink_plans').select('id,name,service_type,package_name,package_price_minor,guest_count,status,notes,ceremonies(kind,name)').eq('workspace_id', workspaceId).is('deleted_at', null).order('created_at', { ascending: false })
    if (error) throw error
    return data.map((row) => ({ id: row.id, values: { name: row.name, category: ({ caterer: 'Food', bartender: 'Drink', combined: 'Service', self_managed: 'Cake' } as Record<string, string>)[row.service_type], vendor: row.package_name ?? '', quantity: row.guest_count?.toString() ?? '', cost: row.package_price_minor == null ? '' : String(row.package_price_minor / 100), event: eventOf(row.ceremonies) }, status: statusFromNotes(title, row.notes, row.status) }))
  }
  if (title === 'Wedding party') {
    const { data, error } = await db.from('wedding_party_members').select('id,name,role,phone,processional_order,responsibilities,outfit_status,wedding_party_ceremonies(ceremonies(kind,name))').eq('workspace_id', workspaceId).is('deleted_at', null).order('created_at', { ascending: false })
    if (error) throw error
    return data.map((row) => ({ id: row.id, values: { name: row.name, role: row.role, phone: row.phone ?? '', order: row.processional_order?.toString() ?? '', responsibility: row.responsibilities ?? '', event: ceremonyLabel(linkedCeremony(row.wedding_party_ceremonies, 'ceremonies')) }, status: displayStatus(title, row.outfit_status) }))
  }
  if (title === 'Packing') {
    const { data, error } = await db.from('packing_items').select('id,name,category,quantity,responsible_person,packed,packing_lists(name,ceremonies(kind,name))').eq('workspace_id', workspaceId).is('deleted_at', null).order('created_at', { ascending: false })
    if (error) throw error
    return data.map((row) => { const list = relation(row.packing_lists) as (RelatedCeremony & { ceremonies?: unknown }) | null; return { id: row.id, values: { item: row.name, category: row.category, quantity: String(row.quantity), owner: row.responsible_person ?? '', event: eventOf(list?.ceremonies) }, status: displayStatus(title, row.packed) } })
  }
  if (title === 'Gifts') {
    const { data, error } = await db.from('gifts').select('id,giver_name,description,gift_type,cash_amount_minor,currency,thank_you_status,notes,ceremonies(kind,name)').eq('workspace_id', workspaceId).is('deleted_at', null).order('received_on', { ascending: false })
    if (error) throw error
    return data.map((row) => ({ id: row.id, values: { guest: row.giver_name ?? '', description: row.description, type: row.gift_type === 'cash' ? 'Cash' : 'Gift', amount: row.cash_amount_minor == null ? '' : String(row.cash_amount_minor / 100), currency: row.currency ?? 'NGN', event: eventOf(row.ceremonies) }, status: statusFromNotes(title, row.notes, row.thank_you_status) }))
  }
  const { data, error } = await db.from('honeymoon_bookings').select('id,title,booking_type,starts_at,provider,booking_reference,amount_minor,status').eq('workspace_id', workspaceId).is('deleted_at', null).order('created_at', { ascending: false })
  if (error) throw error
  return data.map((row) => ({ id: row.id, values: { name: row.title, type: ({ flight: 'Flight', accommodation: 'Accommodation', transport: 'Transport', activity: 'Activity', other: 'Expense' } as Record<string, string>)[row.booking_type] ?? 'Expense', date: lagosParts(row.starts_at).date, provider: row.provider ?? '', reference: row.booking_reference ?? '', cost: row.amount_minor == null ? '' : String(row.amount_minor / 100) }, status: displayStatus(title, row.status) }))
}

async function insertRow(table: string, payload: Record<string, unknown>) {
  const { data, error } = await requireSupabase().from(table).insert(payload).select('id').single()
  if (error) throw error
  return data.id as string
}

async function link(table: string, payload: Record<string, unknown>) {
  const { error } = await requireSupabase().from(table).insert(payload)
  if (error) throw error
}

async function updateRow(table: string, id: string, context: Context, payload: Record<string, unknown>) {
  const { error } = await requireSupabase().from(table).update({ ...payload, updated_by: context.userId }).eq('workspace_id', context.workspaceId).eq('id', id)
  if (error) throw error
}

async function setJoinCeremony(table: string, recordKey: string, recordId: string, ceremonyId: string | null, context: Context) {
  const db = requireSupabase()
  const { data, error } = await db.from(table).select('ceremony_id').eq('workspace_id', context.workspaceId).eq(recordKey, recordId)
  if (error) throw error
  const linkedIds = new Set((data ?? []).map((item) => item.ceremony_id as string))
  if (ceremonyId && !linkedIds.has(ceremonyId)) {
    await link(table, { workspace_id: context.workspaceId, [recordKey]: recordId, ceremony_id: ceremonyId, created_by: context.userId })
  }
  let deleteQuery = db.from(table).delete().eq('workspace_id', context.workspaceId).eq(recordKey, recordId)
  if (ceremonyId) deleteQuery = deleteQuery.neq('ceremony_id', ceremonyId)
  const { error: deleteError } = await deleteQuery
  if (deleteError) throw deleteError
}

async function packingListId(context: Context, ceremonyId: string | null, event?: string) {
  const db = requireSupabase()
  let listQuery = db.from('packing_lists').select('id').eq('workspace_id', context.workspaceId).is('deleted_at', null)
  listQuery = ceremonyId ? listQuery.eq('ceremony_id', ceremonyId) : listQuery.is('ceremony_id', null)
  const { data, error } = await listQuery.limit(1).maybeSingle()
  if (error) throw error
  return data?.id as string | undefined ?? await insertRow('packing_lists', { ...audit(context), ceremony_id: ceremonyId, name: ceremonyId ? `${event} packing` : 'General packing', list_type: ceremonyId ? 'ceremony' : 'custom' })
}

export async function addRegistryRecord(title: RegistryTitle, values: Record<string, string>, context: Context) {
  const base = audit(context)
  const ceremonyId = ceremonyIdForEvent(context.ceremonies, values.event)
  if (title === 'Calendar') {
    const startsAt = lagosIso(values.date, values.time)
    if (!startsAt) throw new Error('Date is required.')
    await insertRow('calendar_entries', { ...base, ceremony_id: ceremonyId, title: values.title, entry_type: ({ Task: 'task', Appointment: 'vendor_appointment', Payment: 'payment', Personal: 'custom' } as Record<string, string>)[values.type || 'Task'], starts_at: startsAt, all_day: !values.time, notes: 'Registry status: scheduled' })
    return
  }
  if (title === 'Itineraries') {
    const startsAt = lagosIso(values.date, values.time)
    if (!startsAt) throw new Error('Date is required.')
    await insertRow('itinerary_items', { ...base, ceremony_id: requireCeremony(context, values.event), title: values.activity, starts_at: startsAt, location: values.location || null, responsible_person: values.owner || null, status: 'planned' })
    return
  }
  if (title === 'Vendors') {
    const id = await insertRow('vendors', { ...base, name: values.name, category: values.category || 'General', website: values.link || null, package_details: values.quote || null, selection_status: 'researching' })
    if (values.contact) await insertRow('vendor_contacts', { ...base, vendor_id: id, name: values.contact, phone: values.phone || null, is_primary: true })
    if (ceremonyId) await link('vendor_ceremonies', { workspace_id: context.workspaceId, vendor_id: id, ceremony_id: ceremonyId, created_by: context.userId })
    return
  }
  if (title === 'Venues') {
    const id = await insertRow('venues', { ...base, name: values.name, address: values.location || null, capacity: values.capacity ? Number(values.capacity) : null, ceremony_fee_minor: toMinor(values.cost), currency: context.currency, availability_notes: values.availability || null, selection_status: 'researching', notes: 'Registry status: Considering' })
    if (ceremonyId) await link('venue_ceremonies', { workspace_id: context.workspaceId, venue_id: id, ceremony_id: ceremonyId, created_by: context.userId })
    return
  }
  if (title === 'Food & drinks') {
    await insertRow('food_drink_plans', { ...base, ceremony_id: requireCeremony(context, values.event), name: values.name, service_type: ({ Food: 'caterer', Drink: 'bartender', Service: 'combined', Cake: 'self_managed' } as Record<string, string>)[values.category || 'Food'], package_name: values.vendor || null, guest_count: values.quantity ? Number(values.quantity) : null, package_price_minor: toMinor(values.cost), currency: context.currency, status: 'option', notes: 'Registry status: Idea' })
    return
  }
  if (title === 'Wedding party') {
    const id = await insertRow('wedding_party_members', { ...base, name: values.name, role: values.role || 'Wedding party', phone: values.phone || null, processional_order: values.order ? Number(values.order) : null, responsibilities: values.responsibility || null, outfit_status: 'invited' })
    if (ceremonyId) await link('wedding_party_ceremonies', { workspace_id: context.workspaceId, member_id: id, ceremony_id: ceremonyId, created_by: context.userId })
    return
  }
  if (title === 'Packing') {
    const listId = await packingListId(context, ceremonyId, values.event)
    await insertRow('packing_items', { ...base, packing_list_id: listId, category: values.category || 'General', name: values.item, quantity: values.quantity ? Number(values.quantity) : 1, responsible_person: values.owner || null, packed: false })
    return
  }
  if (title === 'Gifts') {
    const isCash = (values.type || 'Gift') === 'Cash'
    const amount = isCash ? toMinor(values.amount) : null
    const currency = values.currency || context.currency
    const money = await moneyDetails(context, amount, currency)
    await insertRow('gifts', { ...base, ceremony_id: ceremonyId, giver_name: values.guest || null, description: values.description, gift_type: isCash ? 'cash' : 'physical', cash_amount_minor: amount, currency: amount === null ? null : currency, ...money, received_on: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date()), thank_you_status: 'pending', notes: 'Registry status: Received' })
    return
  }
  const db = requireSupabase()
  const { data: existing, error } = await db.from('honeymoon_trips').select('id').eq('workspace_id', context.workspaceId).is('deleted_at', null).order('created_at').limit(1).maybeSingle()
  if (error) throw error
  const tripId = existing?.id ?? await insertRow('honeymoon_trips', { ...base, name: 'Honeymoon', currency: context.currency, status: 'planning' })
  const amount = toMinor(values.cost)
  const money = await moneyDetails(context, amount, context.currency)
  await insertRow('honeymoon_bookings', { ...base, trip_id: tripId, booking_type: ({ Flight: 'flight', Accommodation: 'accommodation', Transport: 'transport', Activity: 'activity', Expense: 'other' } as Record<string, string>)[values.type || 'Flight'], provider: values.provider || null, title: values.name, starts_at: lagosIso(values.date), booking_reference: values.reference || null, status: 'planned', amount_minor: amount, currency: amount === null ? null : context.currency, ...money })
}

export async function updateRegistryRecord(title: RegistryTitle, record: RegistryRecord, values: Record<string, string>, context: Context) {
  const ceremonyId = ceremonyIdForEvent(context.ceremonies, values.event)
  if (title === 'Calendar') {
    const startsAt = lagosIso(values.date, values.time)
    if (!startsAt) throw new Error('Date is required.')
    const entryType = ({ Task: 'task', Appointment: 'vendor_appointment', Payment: 'payment', Personal: 'custom' } as Record<string, string>)[values.type]
    if (!entryType) throw new Error('Choose a valid calendar entry type.')
    await updateRow('calendar_entries', record.id, context, { ceremony_id: ceremonyId, title: values.title, entry_type: entryType, starts_at: startsAt, all_day: !values.time })
    return
  }
  if (title === 'Itineraries') {
    const startsAt = lagosIso(values.date, values.time)
    if (!startsAt) throw new Error('Date is required.')
    await updateRow('itinerary_items', record.id, context, { ceremony_id: requireCeremony(context, values.event), title: values.activity, starts_at: startsAt, location: values.location || null, responsible_person: values.owner || null })
    return
  }
  if (title === 'Vendors') {
    await updateRow('vendors', record.id, context, { name: values.name, category: values.category || 'General', website: values.link || null, package_details: values.quote || null })
    const db = requireSupabase()
    const { data: contacts, error } = await db.from('vendor_contacts').select('id').eq('workspace_id', context.workspaceId).eq('vendor_id', record.id).is('deleted_at', null).order('is_primary', { ascending: false }).limit(1)
    if (error) throw error
    const contactId = contacts?.[0]?.id as string | undefined
    if (values.contact) {
      if (contactId) await updateRow('vendor_contacts', contactId, context, { name: values.contact, phone: values.phone || null, is_primary: true })
      else await insertRow('vendor_contacts', { ...audit(context), vendor_id: record.id, name: values.contact, phone: values.phone || null, is_primary: true })
    } else if (contactId) {
      await updateRow('vendor_contacts', contactId, context, { deleted_at: new Date().toISOString() })
    }
    await setJoinCeremony('vendor_ceremonies', 'vendor_id', record.id, ceremonyId, context)
    return
  }
  if (title === 'Venues') {
    await updateRow('venues', record.id, context, { name: values.name, address: values.location || null, capacity: values.capacity ? Number(values.capacity) : null, ceremony_fee_minor: toMinor(values.cost), currency: context.currency, availability_notes: values.availability || null })
    await setJoinCeremony('venue_ceremonies', 'venue_id', record.id, ceremonyId, context)
    return
  }
  if (title === 'Food & drinks') {
    const serviceType = ({ Food: 'caterer', Drink: 'bartender', Service: 'combined', Cake: 'self_managed' } as Record<string, string>)[values.category]
    if (!serviceType) throw new Error('Choose a valid food and drink category.')
    await updateRow('food_drink_plans', record.id, context, { ceremony_id: requireCeremony(context, values.event), name: values.name, service_type: serviceType, package_name: values.vendor || null, guest_count: values.quantity ? Number(values.quantity) : null, package_price_minor: toMinor(values.cost), currency: context.currency })
    return
  }
  if (title === 'Wedding party') {
    await updateRow('wedding_party_members', record.id, context, { name: values.name, role: values.role || 'Wedding party', phone: values.phone || null, processional_order: values.order ? Number(values.order) : null, responsibilities: values.responsibility || null })
    await setJoinCeremony('wedding_party_ceremonies', 'member_id', record.id, ceremonyId, context)
    return
  }
  if (title === 'Packing') {
    const listId = await packingListId(context, ceremonyId, values.event)
    await updateRow('packing_items', record.id, context, { packing_list_id: listId, category: values.category || 'General', name: values.item, quantity: values.quantity ? Number(values.quantity) : 1, responsible_person: values.owner || null })
    return
  }
  if (title === 'Gifts') {
    const isCash = values.type === 'Cash'
    if (!isCash && values.type !== 'Gift') throw new Error('Choose a valid gift type.')
    const amount = isCash ? toMinor(values.amount) : null
    const currency = values.currency || context.currency
    const money = await moneyDetails(context, amount, currency)
    await updateRow('gifts', record.id, context, { ceremony_id: ceremonyId, giver_name: values.guest || null, description: values.description, gift_type: isCash ? 'cash' : 'physical', cash_amount_minor: amount, currency: amount === null ? null : currency, exchange_rate: null, rate_source: null, rate_retrieved_at: null, ngn_minor: null, ...money })
    return
  }
  const bookingType = ({ Flight: 'flight', Accommodation: 'accommodation', Transport: 'transport', Activity: 'activity', Expense: 'other' } as Record<string, string>)[values.type]
  if (!bookingType) throw new Error('Choose a valid honeymoon booking type.')
  const amount = toMinor(values.cost)
  const money = await moneyDetails(context, amount, context.currency)
  await updateRow('honeymoon_bookings', record.id, context, { booking_type: bookingType, provider: values.provider || null, title: values.name, starts_at: lagosIso(values.date), booking_reference: values.reference || null, amount_minor: amount, currency: amount === null ? null : context.currency, exchange_rate: null, rate_source: null, rate_retrieved_at: null, ngn_minor: null, ...money })
}

export async function updateRegistryStatus(title: RegistryTitle, record: RegistryRecord, status: string, workspaceId: string, userId: string) {
  const db = requireSupabase()
  const mapped = statusMaps[title][status]
  let table = ''
  let update: Record<string, unknown> = { updated_by: userId }
  if (title === 'Calendar' || title === 'Venues' || title === 'Food & drinks' || title === 'Gifts') {
    table = title === 'Calendar' ? 'calendar_entries' : title === 'Venues' ? 'venues' : title === 'Food & drinks' ? 'food_drink_plans' : 'gifts'
    const { data, error } = await db.from(table).select('notes').eq('workspace_id', workspaceId).eq('id', record.id).single()
    if (error) throw error
    update.notes = `Registry status: ${status}\n${data.notes?.replace(STATUS_MARKER, '') ?? ''}`.trim()
    if (title === 'Venues') update.selection_status = mapped
    if (title === 'Food & drinks') update.status = mapped
    if (title === 'Gifts') {
      update.thank_you_status = mapped
      update.thank_you_sent_on = mapped === 'sent' ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date()) : null
    }
  } else if (title === 'Itineraries') { table = 'itinerary_items'; update.status = mapped }
  else if (title === 'Vendors') { table = 'vendors'; update.selection_status = mapped }
  else if (title === 'Wedding party') { table = 'wedding_party_members'; update.outfit_status = mapped }
  else if (title === 'Packing') { table = 'packing_items'; update = { ...update, packed: mapped === 'true', packed_at: mapped === 'true' ? new Date().toISOString() : null } }
  else { table = 'honeymoon_bookings'; update.status = mapped }
  const { error } = await db.from(table).update(update).eq('workspace_id', workspaceId).eq('id', record.id)
  if (error) throw error
}

export async function softDeleteRegistry(title: RegistryTitle, id: string, workspaceId: string, userId: string) {
  const table: Record<RegistryTitle, string> = {
    Calendar: 'calendar_entries', Itineraries: 'itinerary_items', Vendors: 'vendors', Venues: 'venues',
    'Food & drinks': 'food_drink_plans', 'Wedding party': 'wedding_party_members', Packing: 'packing_items',
    Gifts: 'gifts', Honeymoon: 'honeymoon_bookings',
  }
  const { error } = await requireSupabase().from(table[title]).update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq('workspace_id', workspaceId).eq('id', id)
  if (error) throw error
}
