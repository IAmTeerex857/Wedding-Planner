import { useDeferredValue, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Plus, Search, Trash2, X } from 'lucide-react'
import { addRegistryRecord, loadCeremonies, loadRegistry, softDeleteRegistry, updateRegistryStatus, type RegistryRecord, type RegistryTitle } from '../lib/registry-persistence'
import { useWorkspace } from '../lib/workspace-context'
import './registry.css'

type Field = { key: string; label: string; type?: 'text' | 'date' | 'time' | 'number' | 'file'; options?: string[]; placeholder?: string; required?: boolean; min?: number }
type Definition = { eyebrow: string; description: string; noun: string; fields: Field[]; statuses: string[]; primaryKey?: string }

const eventField: Field = { key: 'event', label: 'Ceremony', options: ['Court', 'Traditional', 'White', 'General / shared'] }
const requiredEventField: Field = { ...eventField, required: true, options: ['Court', 'Traditional', 'White'] }

const definitions: Record<string, Definition> = {
  Calendar: { eyebrow: 'Schedule', description: 'See ceremonies, appointments, payments, and planning deadlines together.', noun: 'calendar entry', fields: [{ key: 'title', label: 'Entry title', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'time', label: 'Time', type: 'time' }, { key: 'type', label: 'Type', options: ['Task', 'Appointment', 'Payment', 'Personal'] }, eventField], statuses: ['Scheduled', 'Complete', 'Cancelled'] },
  Itineraries: { eyebrow: 'Run of show', description: 'Build ordered schedules for every part of each celebration.', noun: 'itinerary item', fields: [{ key: 'activity', label: 'Activity', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'time', label: 'Time', type: 'time' }, { key: 'location', label: 'Location' }, { key: 'owner', label: 'Person responsible' }, requiredEventField], statuses: ['Planned', 'Confirmed', 'Complete'] },
  Seating: { eyebrow: 'Traditional & White', description: 'Create tables and capacities before assigning confirmed guests.', noun: 'table', fields: [{ key: 'name', label: 'Table name' }, { key: 'capacity', label: 'Capacity', type: 'number' }, { key: 'area', label: 'Area or section' }, { ...eventField, options: ['Traditional', 'White'] }], statuses: ['Open', 'Locked'] },
  Vendors: { eyebrow: 'Supplier directory', description: 'Compare suppliers, packages, contacts, contracts, and balances.', noun: 'vendor', fields: [{ key: 'name', label: 'Company name', required: true }, { key: 'category', label: 'Category', required: true }, { key: 'contact', label: 'Contact person' }, { key: 'phone', label: 'Phone' }, { key: 'quote', label: 'Quote / package' }, eventField], statuses: ['Considering', 'Shortlisted', 'Selected', 'Declined'] },
  Venues: { eyebrow: 'Location shortlist', description: 'Compare capacity, availability, inclusions, costs, and selection status.', noun: 'venue', fields: [{ key: 'name', label: 'Venue name', required: true }, { key: 'location', label: 'Location' }, { key: 'capacity', label: 'Capacity', type: 'number' }, { key: 'cost', label: 'Estimated cost', type: 'number' }, { key: 'availability', label: 'Available date', type: 'date' }, eventField], statuses: ['Considering', 'Viewing booked', 'Shortlisted', 'Selected'] },
  'Food & drinks': { eyebrow: 'Menu planning', description: 'Plan menus, drinks, quantities, caterers, tastings, and package costs.', noun: 'menu item', fields: [{ key: 'name', label: 'Item or package', required: true }, { key: 'category', label: 'Category', options: ['Food', 'Drink', 'Cake', 'Service'] }, { key: 'vendor', label: 'Caterer / bartender' }, { key: 'quantity', label: 'Quantity', type: 'number' }, { key: 'cost', label: 'Estimated cost', type: 'number' }, requiredEventField], statuses: ['Idea', 'Tasting', 'Approved', 'Ordered'] },
  'Wedding party': { eyebrow: 'People & roles', description: 'Coordinate roles, ceremony participation, responsibilities, and outfits.', noun: 'party member', fields: [{ key: 'name', label: 'Name', required: true }, { key: 'role', label: 'Role', required: true }, { key: 'phone', label: 'Phone' }, { key: 'order', label: 'Processional order', type: 'number' }, { key: 'responsibility', label: 'Responsibility' }, eventField], statuses: ['Invited', 'Confirmed', 'Ready'] },
  Packing: { eyebrow: 'Packing lists', description: 'Prepare ceremony, wedding-weekend, and honeymoon packing lists.', noun: 'packing item', fields: [{ key: 'item', label: 'Item', required: true }, { key: 'category', label: 'Category', required: true }, { key: 'quantity', label: 'Quantity', type: 'number', min: 1 }, { key: 'owner', label: 'Person responsible' }, eventField], statuses: ['Not packed', 'Packed'] },
  Gifts: { eyebrow: 'Gifts & thanks', description: 'Record gifts, cash amounts, ceremony links, and thank-you progress.', noun: 'gift', primaryKey: 'description', fields: [{ key: 'guest', label: 'Guest' }, { key: 'description', label: 'Gift description', required: true }, { key: 'type', label: 'Type', options: ['Gift', 'Cash'] }, { key: 'amount', label: 'Cash amount', type: 'number' }, { key: 'currency', label: 'Currency', options: ['NGN', 'GBP', 'USD', 'EUR'] }, eventField], statuses: ['Received', 'Thank-you due', 'Thank-you sent'] },
  'Photos & files': { eyebrow: 'Private library', description: 'Keep inspiration, receipts, contracts, images, and wedding documents private.', noun: 'file', fields: [{ key: 'name', label: 'Title' }, { key: 'category', label: 'Category', options: ['Photo', 'Inspiration', 'Receipt', 'Contract', 'Quote', 'Invitation', 'Travel'] }, { key: 'file', label: 'Choose file', type: 'file' }, eventField], statuses: ['Active', 'Archived'] },
  Honeymoon: { eyebrow: 'Travel planning', description: 'Plan destinations, bookings, itinerary, expenses, and documents.', noun: 'honeymoon record', fields: [{ key: 'name', label: 'Booking or activity', required: true }, { key: 'type', label: 'Type', options: ['Flight', 'Accommodation', 'Transport', 'Activity', 'Expense'] }, { key: 'date', label: 'Date', type: 'date' }, { key: 'provider', label: 'Provider' }, { key: 'reference', label: 'Booking reference' }, { key: 'cost', label: 'Cost', type: 'number' }], statuses: ['Researching', 'Reserved', 'Paid', 'Complete'] },
}

const persistedTitles = new Set<RegistryTitle>(['Calendar', 'Itineraries', 'Vendors', 'Venues', 'Food & drinks', 'Wedding party', 'Packing', 'Gifts', 'Honeymoon'])

function isRegistryTitle(title: string): title is RegistryTitle {
  return persistedTitles.has(title as RegistryTitle)
}

export function ModulePage({ title }: { title: string }) {
  if (title === 'Reports') return <ReportsPage />
  if (title === 'Settings') return <SettingsPage />
  const definition = definitions[title]
  if (!definition) return null
  return <Registry title={title} definition={definition} />
}

function Registry({ title, definition }: { title: string; definition: Definition }) {
  const { workspace, userId, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const persistent = isRegistryTitle(title) && !isPreview
  const [previewRecords, setPreviewRecords] = useState<RegistryRecord[]>([])
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const ceremoniesQuery = useQuery({ queryKey: ['ceremony-options', workspace.id], enabled: persistent, queryFn: () => loadCeremonies(workspace.id) })
  const recordsQuery = useQuery({ queryKey: ['registry', title, workspace.id], enabled: persistent, queryFn: () => loadRegistry(title as RegistryTitle, workspace.id) })
  const addMutation = useMutation({
    mutationFn: (values: Record<string, string>) => addRegistryRecord(title as RegistryTitle, values, { workspaceId: workspace.id, userId, currency: workspace.reporting_currency, ceremonies: ceremoniesQuery.data ?? [] }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['registry', title, workspace.id] }); setAdding(false) },
  })
  const statusMutation = useMutation({
    mutationFn: ({ record, status }: { record: RegistryRecord; status: string }) => updateRegistryStatus(title as RegistryTitle, record, status, workspace.id, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['registry', title, workspace.id] }),
  })
  const deleteMutation = useMutation({
    mutationFn: (record: RegistryRecord) => softDeleteRegistry(title as RegistryTitle, record.id, workspace.id, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['registry', title, workspace.id] }),
  })
  const records = persistent ? recordsQuery.data ?? [] : previewRecords
  const deferredQuery = useDeferredValue(query.toLocaleLowerCase())
  const filtered = records.filter((record) => Object.values(record.values).join(' ').toLocaleLowerCase().includes(deferredQuery))
  const error = recordsQuery.error ?? ceremoniesQuery.error ?? addMutation.error ?? statusMutation.error

  async function addRecord(values: Record<string, string>) {
    if (!persistent) {
      setPreviewRecords((current) => [{ id: crypto.randomUUID(), values, status: definition.statuses[0] }, ...current])
      setAdding(false)
      return
    }
    await addMutation.mutateAsync(values)
  }

  function changeStatus(record: RegistryRecord, status: string) {
    if (!persistent) setPreviewRecords((current) => current.map((item) => item.id === record.id ? { ...item, status } : item))
    else statusMutation.mutate({ record, status })
  }

  function removeRecord(record: RegistryRecord) {
    if (!persistent) setPreviewRecords((current) => current.filter((item) => item.id !== record.id))
    else deleteMutation.mutate(record)
  }

  return <div className="page registry-page">
    <header className="page-header"><div><p className="eyebrow">{definition.eyebrow}</p><h1>{title}</h1><p className="page-lead">{definition.description}</p></div><button className="button primary" type="button" onClick={() => setAdding(true)}><Plus size={15} /> Add {definition.noun}</button></header>
    {adding && <RegistryForm definition={definition} saving={addMutation.isPending} onClose={() => setAdding(false)} onAdd={addRecord} />}
    {error && <p className="data-error">{error.message}</p>}
    <section className="registry-panel">
      <header><label><Search size={15} /><span className="sr-only">Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLocaleLowerCase()}`} /></label><span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span></header>
      {recordsQuery.isLoading && persistent ? <div className="registry-empty"><p>Loading records...</p></div> : filtered.length ? <div className="registry-list">{filtered.map((record) => <article key={record.id}><div><strong>{record.values[definition.primaryKey ?? definition.fields[0].key]}</strong><small>{definition.fields.filter((field) => field.key !== (definition.primaryKey ?? definition.fields[0].key)).map((field) => record.values[field.key]).filter(Boolean).join(' / ') || `No additional ${definition.noun} details`}</small></div><select value={record.status} onChange={(event) => changeStatus(record, event.target.value)}>{definition.statuses.map((status) => <option key={status}>{status}</option>)}</select><button className="registry-delete" type="button" aria-label={`Remove ${definition.noun}`} onClick={() => removeRecord(record)}><Trash2 size={14} /></button></article>)}</div> : <div className="registry-empty"><Plus size={20} /><h2>No {definition.noun}s yet</h2><p>Add the first record when the information is ready.</p></div>}
    </section>
  </div>
}

function RegistryForm({ definition, saving, onClose, onAdd }: { definition: Definition; saving: boolean; onClose: () => void; onAdd: (values: Record<string, string>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(definition.fields.filter((field) => field.options).map((field) => [field.key, field.options![0]])))
  async function submit(event: FormEvent) { event.preventDefault(); const cleanValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])); await onAdd(cleanValues) }
  return <section className="registry-form"><header><div><p className="eyebrow">New record</p><h2>Add {definition.noun}</h2></div><button type="button" onClick={onClose} aria-label="Close"><X size={17} /></button></header><form onSubmit={submit}><div>{definition.fields.map((field) => <label key={field.key}><span>{field.label}</span>{field.options ? <select required={field.required} value={values[field.key] ?? field.options[0]} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}>{field.options.map((value) => <option key={value}>{value}</option>)}</select> : <input type={field.type ?? 'text'} required={field.required} min={field.type === 'number' ? field.min ?? 0 : undefined} value={values[field.key] ?? ''} placeholder={field.placeholder} onChange={(event) => setValues((current) => ({ ...current, [field.key]: field.type === 'file' ? event.target.files?.[0]?.name ?? '' : event.target.value }))} />}</label>)}</div><footer><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></footer></form></section>
}

function ReportsPage() {
  const reports = ['Wedding overview', 'Ceremony summary', 'Budget summary', 'Guest & RSVP report', 'Seating chart', 'Itineraries', 'Packing lists', 'Attire & aso-ebi', 'Traditional requirements', 'Honeymoon itinerary']
  return <div className="page registry-page"><header className="page-header"><div><p className="eyebrow">Exports</p><h1>Reports</h1><p className="page-lead">Create printable planning packs and clean CSV exports from the information in your workspace.</p></div></header><section className="report-grid">{reports.map((report) => <article key={report}><FileText size={18} /><div><strong>{report}</strong><small>PDF report</small></div><button type="button" onClick={() => window.print()}><Download size={15} /> Generate</button></article>)}</section></div>
}

function SettingsPage() {
  return <div className="page registry-page"><header className="page-header"><div><p className="eyebrow">Workspace control</p><h1>Settings</h1><p className="page-lead">Manage ceremony defaults, reporting currency, timezone, reminders, and account details.</p></div></header><section className="settings-grid"><label>Workspace name<input defaultValue="Timmy & Bisola" /></label><label>Reporting currency<select defaultValue="NGN"><option>NGN</option><option>GBP</option><option>USD</option><option>EUR</option></select></label><label>Timezone<input defaultValue="Africa/Lagos" readOnly /></label><label>Weekly summary<select defaultValue="Sunday evening"><option>Sunday evening</option></select></label><button className="button primary" type="button">Save settings</button></section></div>
}
