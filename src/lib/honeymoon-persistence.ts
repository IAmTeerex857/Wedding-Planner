import { requireSupabase } from './supabase'

export type HoneymoonDestination = {
  id: string
  location: string
  arrivalDate: string
  departureDate: string
  cost: string
  status: string
}

export type HoneymoonDetail = {
  id: string
  destinationId: string
  title: string
  type: string
  date: string
  cost: string
}

export type HoneymoonChecklistItem = { id: string; title: string; dueDate: string; completed: boolean }

export type HoneymoonContext = { workspaceId: string; userId: string; currency: string }

const destinationStatuses: Record<string, string> = { Planning: 'planning', Booked: 'booked', 'In progress': 'in_progress', Complete: 'completed' }
const detailTypes: Record<string, string> = { Flight: 'flight', Accommodation: 'accommodation', Transport: 'transport', Activity: 'activity', Other: 'other' }

function displayValue(map: Record<string, string>, stored: string) {
  return Object.entries(map).find(([, value]) => value === stored)?.[0] ?? Object.keys(map)[0]
}

function toMinor(value?: string) {
  if (!value) return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null
}

function dateFromIso(value?: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

function dateToIso(value?: string) {
  return value ? new Date(`${value}T00:00:00+01:00`).toISOString() : null
}

function audit(context: HoneymoonContext) {
  return { workspace_id: context.workspaceId, created_by: context.userId, updated_by: context.userId }
}

async function moneyDetails(context: HoneymoonContext, amountMinor: number | null) {
  if (amountMinor === null) return {}
  if (context.currency === 'NGN') return { exchange_rate: 1, rate_source: 'native', rate_retrieved_at: new Date().toISOString(), ngn_minor: amountMinor }
  const { data, error } = await requireSupabase().from('exchange_rates').select('rate,source,retrieved_at').eq('workspace_id', context.workspaceId).eq('base_currency', context.currency).eq('quote_currency', 'NGN').is('deleted_at', null).order('rate_date', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Add a ${context.currency} to NGN exchange rate before saving this amount.`)
  return { exchange_rate: Number(data.rate), rate_source: data.source, rate_retrieved_at: data.retrieved_at, ngn_minor: Math.round(amountMinor * Number(data.rate)) }
}

export async function loadHoneymoonDestinations(workspaceId: string): Promise<HoneymoonDestination[]> {
  const { data, error } = await requireSupabase().from('honeymoon_trips').select('id,name,start_date,end_date,budget_minor,status').eq('workspace_id', workspaceId).is('deleted_at', null).order('start_date', { nullsFirst: false }).order('created_at')
  if (error) throw error
  return data.map((row) => ({ id: row.id, location: row.name, arrivalDate: row.start_date ?? '', departureDate: row.end_date ?? '', cost: row.budget_minor == null ? '' : String(row.budget_minor / 100), status: displayValue(destinationStatuses, row.status) }))
}

export async function addHoneymoonDestination(values: Omit<HoneymoonDestination, 'id' | 'status'>, context: HoneymoonContext) {
  const { error } = await requireSupabase().from('honeymoon_trips').insert({ ...audit(context), name: values.location, start_date: values.arrivalDate || null, end_date: values.departureDate || null, budget_minor: toMinor(values.cost), currency: context.currency, status: 'planning' })
  if (error) throw error
}

export async function updateHoneymoonDestination(id: string, values: Omit<HoneymoonDestination, 'id' | 'status'>, context: HoneymoonContext) {
  const { error } = await requireSupabase().from('honeymoon_trips').update({ name: values.location, start_date: values.arrivalDate || null, end_date: values.departureDate || null, budget_minor: toMinor(values.cost), currency: context.currency, updated_by: context.userId }).eq('workspace_id', context.workspaceId).eq('id', id)
  if (error) throw error
}

export async function updateHoneymoonDestinationStatus(id: string, status: string, context: HoneymoonContext) {
  const stored = destinationStatuses[status]
  if (!stored) throw new Error('Choose a valid destination status.')
  const { error } = await requireSupabase().from('honeymoon_trips').update({ status: stored, updated_by: context.userId }).eq('workspace_id', context.workspaceId).eq('id', id)
  if (error) throw error
}

export async function deleteHoneymoonDestination(id: string, context: HoneymoonContext) {
  const { error } = await requireSupabase().from('honeymoon_trips').update({ deleted_at: new Date().toISOString(), updated_by: context.userId }).eq('workspace_id', context.workspaceId).eq('id', id)
  if (error) throw error
}

export async function loadHoneymoonDetails(workspaceId: string): Promise<HoneymoonDetail[]> {
  const { data, error } = await requireSupabase().from('honeymoon_bookings').select('id,trip_id,title,booking_type,starts_at,amount_minor').eq('workspace_id', workspaceId).is('deleted_at', null).order('starts_at', { nullsFirst: false }).order('created_at')
  if (error) throw error
  return data.map((row) => ({ id: row.id, destinationId: row.trip_id, title: row.title, type: displayValue(detailTypes, row.booking_type), date: dateFromIso(row.starts_at), cost: row.amount_minor == null ? '' : String(row.amount_minor / 100) }))
}

export async function addHoneymoonDetail(destinationId: string, values: Omit<HoneymoonDetail, 'id' | 'destinationId'>, context: HoneymoonContext) {
  const bookingType = detailTypes[values.type]
  if (!bookingType) throw new Error('Choose a valid detail type.')
  const amount = toMinor(values.cost)
  const money = await moneyDetails(context, amount)
  const { error } = await requireSupabase().from('honeymoon_bookings').insert({ ...audit(context), trip_id: destinationId, title: values.title, booking_type: bookingType, starts_at: dateToIso(values.date), status: 'planned', amount_minor: amount, currency: amount === null ? null : context.currency, ...money })
  if (error) throw error
}

export async function updateHoneymoonDetail(id: string, values: Omit<HoneymoonDetail, 'id' | 'destinationId'>, context: HoneymoonContext) {
  const bookingType = detailTypes[values.type]
  if (!bookingType) throw new Error('Choose a valid detail type.')
  const amount = toMinor(values.cost)
  const money = await moneyDetails(context, amount)
  const { error } = await requireSupabase().from('honeymoon_bookings').update({ title: values.title, booking_type: bookingType, starts_at: dateToIso(values.date), amount_minor: amount, currency: amount === null ? null : context.currency, exchange_rate: null, rate_source: null, rate_retrieved_at: null, ngn_minor: null, ...money, updated_by: context.userId }).eq('workspace_id', context.workspaceId).eq('id', id)
  if (error) throw error
}

export async function deleteHoneymoonDetail(id: string, context: HoneymoonContext) {
  const { error } = await requireSupabase().from('honeymoon_bookings').update({ deleted_at: new Date().toISOString(), updated_by: context.userId }).eq('workspace_id', context.workspaceId).eq('id', id)
  if (error) throw error
}

export async function loadHoneymoonChecklist(workspaceId: string): Promise<HoneymoonChecklistItem[]> {
  const { data, error } = await requireSupabase().from('honeymoon_checklist_items').select('id,title,due_date,completed').eq('workspace_id', workspaceId).is('deleted_at', null).order('completed').order('position').order('created_at')
  if (error) throw error
  return data.map((item) => ({ id: item.id, title: item.title, dueDate: item.due_date ?? '', completed: item.completed }))
}

export async function addHoneymoonChecklistItem(title: string, dueDate: string, context: HoneymoonContext) {
  const { data: trip, error: tripError } = await requireSupabase().from('honeymoon_trips').select('id').eq('workspace_id', context.workspaceId).is('deleted_at', null).order('created_at').limit(1).maybeSingle()
  if (tripError) throw tripError
  if (!trip) throw new Error('Add a honeymoon location before adding checklist items.')
  const { error } = await requireSupabase().from('honeymoon_checklist_items').insert({ ...audit(context), trip_id: trip.id, title, due_date: dueDate || null })
  if (error) throw error
}

export async function setHoneymoonChecklistItemCompleted(id: string, completed: boolean, context: HoneymoonContext) {
  const { error } = await requireSupabase().from('honeymoon_checklist_items').update({ completed, completed_at: completed ? new Date().toISOString() : null, updated_by: context.userId }).eq('workspace_id', context.workspaceId).eq('id', id)
  if (error) throw error
}

export async function deleteHoneymoonChecklistItem(id: string, context: HoneymoonContext) {
  const { error } = await requireSupabase().from('honeymoon_checklist_items').update({ deleted_at: new Date().toISOString(), updated_by: context.userId }).eq('workspace_id', context.workspaceId).eq('id', id)
  if (error) throw error
}
