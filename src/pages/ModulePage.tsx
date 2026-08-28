import { useDeferredValue, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Pencil, Plus, Search, Trash2, X } from '../components/KoboyoIcon'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { addRegistryRecord, loadCeremonies, loadRegistry, softDeleteRegistry, updateRegistryRecord, updateRegistryStatus, type RegistryRecord, type RegistryTitle } from '../lib/registry-persistence'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import { pillTone } from '../lib/pills'
import './registry.css'

type Field = { key: string; label: string; type?: 'text' | 'date' | 'time' | 'number' | 'file'; options?: string[]; placeholder?: string; required?: boolean; min?: number; step?: number }
type Definition = { eyebrow: string; description: string; noun: string; fields: Field[]; statuses: string[]; primaryKey?: string }
type VendorCategory = { id: string; name: string; position: number }

const eventField: Field = { key: 'event', label: 'Ceremony', options: ['Court', 'Traditional', 'White', 'General / shared'] }
const requiredEventField: Field = { ...eventField, required: true, options: ['Court', 'Traditional', 'White'] }
const defaultVendorCategories = ['Hall', 'Cars', 'Hotels', 'Tailor', 'Food', 'Drinks', 'Photography', 'Videography', 'Decor', 'Entertainment', 'Beauty', 'Cake', 'Invitations', 'Security', 'Rentals', 'Gifts', 'Other']

const definitions: Record<string, Definition> = {
  Calendar: { eyebrow: 'Schedule', description: 'See ceremonies, appointments, payments, and planning deadlines together.', noun: 'calendar entry', fields: [{ key: 'title', label: 'Entry title', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'time', label: 'Time', type: 'time' }, { key: 'type', label: 'Type', options: ['Task', 'Appointment', 'Payment', 'Personal'] }, eventField], statuses: ['Scheduled', 'Complete', 'Cancelled'] },
  Itineraries: { eyebrow: 'Run of show', description: 'Build ordered schedules for every part of each celebration.', noun: 'itinerary item', fields: [{ key: 'activity', label: 'Activity', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'time', label: 'Time', type: 'time' }, { key: 'location', label: 'Location' }, { key: 'owner', label: 'Person responsible' }, requiredEventField], statuses: ['Planned', 'Confirmed', 'Complete'] },
  Seating: { eyebrow: 'Traditional & White', description: 'Create tables and capacities before assigning confirmed guests.', noun: 'table', fields: [{ key: 'name', label: 'Table name' }, { key: 'capacity', label: 'Capacity', type: 'number' }, { key: 'area', label: 'Area or section' }, { ...eventField, options: ['Traditional', 'White'] }], statuses: ['Open', 'Locked'] },
  Vendors: { eyebrow: 'Supplier directory', description: 'Compare suppliers, packages, contacts, contracts, and balances.', noun: 'vendor', fields: [{ key: 'name', label: 'Company name', required: true }, { key: 'category', label: 'Category', required: true, options: defaultVendorCategories }, { key: 'contact', label: 'Contact person' }, { key: 'phone', label: 'Phone' }, { key: 'quote', label: 'Quote / package' }, eventField], statuses: ['Considering', 'Shortlisted', 'Selected', 'Declined'] },
  Venues: { eyebrow: 'Location shortlist', description: 'Compare capacity, availability, inclusions, costs, and selection status.', noun: 'venue', fields: [{ key: 'name', label: 'Venue name', required: true }, { key: 'location', label: 'Location' }, { key: 'capacity', label: 'Capacity', type: 'number' }, { key: 'cost', label: 'Estimated cost', type: 'number', step: 0.01 }, { key: 'availability', label: 'Available date', type: 'date' }, eventField], statuses: ['Considering', 'Viewing booked', 'Shortlisted', 'Selected'] },
  'Food & drinks': { eyebrow: 'Menu planning', description: 'Plan menus, drinks, quantities, caterers, tastings, and package costs.', noun: 'menu item', fields: [{ key: 'name', label: 'Item or package', required: true }, { key: 'category', label: 'Category', options: ['Food', 'Drink', 'Cake', 'Service'] }, { key: 'vendor', label: 'Caterer / bartender' }, { key: 'quantity', label: 'Quantity', type: 'number' }, { key: 'cost', label: 'Estimated cost', type: 'number', step: 0.01 }, requiredEventField], statuses: ['Idea', 'Tasting', 'Approved', 'Ordered'] },
  'Wedding party': { eyebrow: 'People & roles', description: 'Coordinate roles, ceremony participation, responsibilities, and outfits.', noun: 'party member', fields: [{ key: 'name', label: 'Name', required: true }, { key: 'role', label: 'Role', required: true }, { key: 'phone', label: 'Phone' }, { key: 'order', label: 'Processional order', type: 'number' }, { key: 'responsibility', label: 'Responsibility' }, eventField], statuses: ['Invited', 'Confirmed', 'Ready'] },
  Packing: { eyebrow: 'Packing lists', description: 'Prepare ceremony, wedding-weekend, and honeymoon packing lists.', noun: 'packing item', fields: [{ key: 'item', label: 'Item', required: true }, { key: 'category', label: 'Category', required: true }, { key: 'quantity', label: 'Quantity', type: 'number', min: 1 }, { key: 'owner', label: 'Person responsible' }, eventField], statuses: ['Not packed', 'Packed'] },
  Gifts: { eyebrow: 'Gifts & thanks', description: 'Record gifts, cash amounts, ceremony links, and thank-you progress.', noun: 'gift', primaryKey: 'description', fields: [{ key: 'guest', label: 'Guest' }, { key: 'description', label: 'Gift description', required: true }, { key: 'type', label: 'Type', options: ['Gift', 'Cash'] }, { key: 'amount', label: 'Cash amount', type: 'number', step: 0.01 }, { key: 'currency', label: 'Currency', options: ['NGN', 'GBP', 'USD', 'EUR'] }, eventField], statuses: ['Received', 'Thank-you due', 'Thank-you sent'] },
  'Photos & files': { eyebrow: 'Private library', description: 'Keep inspiration, receipts, contracts, images, and wedding documents private.', noun: 'file', fields: [{ key: 'name', label: 'Title' }, { key: 'category', label: 'Category', options: ['Photo', 'Inspiration', 'Receipt', 'Contract', 'Quote', 'Invitation', 'Travel'] }, { key: 'file', label: 'Choose file', type: 'file' }, eventField], statuses: ['Active', 'Archived'] },
  Honeymoon: { eyebrow: 'Travel planning', description: 'Plan destinations, bookings, itinerary, expenses, and documents.', noun: 'honeymoon record', fields: [{ key: 'name', label: 'Booking or activity', required: true }, { key: 'type', label: 'Type', options: ['Flight', 'Accommodation', 'Transport', 'Activity', 'Expense'] }, { key: 'date', label: 'Date', type: 'date' }, { key: 'provider', label: 'Provider' }, { key: 'reference', label: 'Booking reference' }, { key: 'cost', label: 'Cost', type: 'number', step: 0.01 }], statuses: ['Researching', 'Reserved', 'Paid', 'Complete'] },
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
  const [editing, setEditing] = useState<RegistryRecord | null>(null)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [newCategory, setNewCategory] = useState('')
  const [previewCategories, setPreviewCategories] = useState<VendorCategory[]>(() => defaultVendorCategories.map((name, position) => ({ id: crypto.randomUUID(), name, position })))
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'record'; record: RegistryRecord; label: string } | { kind: 'category'; category: VendorCategory } | null>(null)
  const categoryPersistent = title === 'Vendors' && !isPreview
  const ceremoniesQuery = useQuery({ queryKey: ['ceremony-options', workspace.id], enabled: persistent, queryFn: () => loadCeremonies(workspace.id) })
  const recordsQuery = useQuery({ queryKey: ['registry', title, workspace.id], enabled: persistent, queryFn: () => loadRegistry(title as RegistryTitle, workspace.id) })
  const categoryQuery = useQuery({
    queryKey: ['vendor-categories', workspace.id],
    enabled: categoryPersistent,
    queryFn: async () => {
      const { data, error } = await supabase!.from('vendor_categories').select('id,name,position').eq('workspace_id', workspace.id).is('deleted_at', null).order('position').order('name')
      if (error) throw error
      return data as VendorCategory[]
    },
  })
  const addMutation = useMutation({
    mutationFn: (values: Record<string, string>) => addRegistryRecord(title as RegistryTitle, values, { workspaceId: workspace.id, userId, currency: workspace.reporting_currency, ceremonies: ceremoniesQuery.data ?? [] }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['registry', title, workspace.id] }); setAdding(false) },
  })
  const statusMutation = useMutation({
    mutationFn: ({ record, status }: { record: RegistryRecord; status: string }) => updateRegistryStatus(title as RegistryTitle, record, status, workspace.id, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['registry', title, workspace.id] }),
  })
  const updateMutation = useMutation({
    mutationFn: ({ record, values }: { record: RegistryRecord; values: Record<string, string> }) => updateRegistryRecord(title as RegistryTitle, record, values, { workspaceId: workspace.id, userId, currency: workspace.reporting_currency, ceremonies: ceremoniesQuery.data ?? [] }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['registry', title, workspace.id] }); setEditing(null) },
  })
  const deleteMutation = useMutation({
    mutationFn: (record: RegistryRecord) => softDeleteRegistry(title as RegistryTitle, record.id, workspace.id, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['registry', title, workspace.id] }),
  })
  const addCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const position = (categoryQuery.data?.at(-1)?.position ?? -1) + 1
      const { error } = await supabase!.from('vendor_categories').insert({ workspace_id: workspace.id, name, position, created_by: userId, updated_by: userId })
      if (error) throw error
    },
    onSuccess: async () => { setNewCategory(''); await queryClient.invalidateQueries({ queryKey: ['vendor-categories', workspace.id] }) },
  })
  const removeCategoryMutation = useMutation({
    mutationFn: async (category: VendorCategory) => {
      const { error } = await supabase!.from('vendor_categories').update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq('workspace_id', workspace.id).eq('id', category.id)
      if (error) throw error
    },
    onSuccess: async (_, category) => { if (categoryFilter === category.name) setCategoryFilter('All'); await queryClient.invalidateQueries({ queryKey: ['vendor-categories', workspace.id] }) },
  })
  const records = persistent ? recordsQuery.data ?? [] : previewRecords
  const deferredQuery = useDeferredValue(query.toLocaleLowerCase())
  const categoryRecords = categoryPersistent ? categoryQuery.data ?? (categoryQuery.isLoading ? defaultVendorCategories.map((name, position) => ({ id: name, name, position })) : []) : previewCategories
  const categories = title === 'Vendors' ? Array.from(new Set([...categoryRecords.map((category) => category.name), ...records.map((record) => record.values.category).filter(Boolean)])) : []
  const formDefinition: Definition = title === 'Vendors' ? { ...definition, fields: definition.fields.map((field) => field.key === 'category' ? { ...field, options: categories.length ? categories : ['Other'] } : field) } : definition
  const filtered = records.filter((record) => Object.values(record.values).join(' ').toLocaleLowerCase().includes(deferredQuery) && (categoryFilter === 'All' || record.values.category === categoryFilter))
  const error = recordsQuery.error ?? ceremoniesQuery.error ?? categoryQuery.error ?? addMutation.error ?? updateMutation.error ?? statusMutation.error ?? deleteMutation.error ?? addCategoryMutation.error ?? removeCategoryMutation.error

  async function addRecord(values: Record<string, string>) {
    if (!persistent) {
      setPreviewRecords((current) => [{ id: crypto.randomUUID(), values, status: definition.statuses[0] }, ...current])
      setAdding(false)
      return
    }
    await addMutation.mutateAsync(values)
  }

  async function updateRecord(values: Record<string, string>) {
    if (!editing) return
    if (!persistent) {
      setPreviewRecords((current) => current.map((record) => record.id === editing.id ? { ...record, values } : record))
      setEditing(null)
      return
    }
    await updateMutation.mutateAsync({ record: editing, values })
  }

  function changeStatus(record: RegistryRecord, status: string) {
    if (!persistent) setPreviewRecords((current) => current.map((item) => item.id === record.id ? { ...item, status } : item))
    else statusMutation.mutate({ record, status })
  }

  function removeRecord(record: RegistryRecord) {
    if (!persistent) setPreviewRecords((current) => current.filter((item) => item.id !== record.id))
    else deleteMutation.mutate(record)
  }

  function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newCategory.trim()
    if (!name || categories.some((category) => category.toLocaleLowerCase() === name.toLocaleLowerCase())) return
    if (categoryPersistent) addCategoryMutation.mutate(name)
    else { setPreviewCategories((current) => [...current, { id: crypto.randomUUID(), name, position: current.length }]); setNewCategory('') }
  }

  function removeCategory(category: VendorCategory) {
    if (records.some((record) => record.values.category.toLocaleLowerCase() === category.name.toLocaleLowerCase())) return
    if (categoryPersistent) removeCategoryMutation.mutate(category)
    else { setPreviewCategories((current) => current.filter((item) => item.id !== category.id)); if (categoryFilter === category.name) setCategoryFilter('All') }
  }

  function confirmDelete() {
    if (!pendingDelete) return
    if (pendingDelete.kind === 'record') removeRecord(pendingDelete.record)
    else removeCategory(pendingDelete.category)
    setPendingDelete(null)
  }

  return <div className="page registry-page">
    <header className="page-header"><div><p className="eyebrow">{definition.eyebrow}</p><h1>{title}</h1><p className="page-lead">{definition.description}</p></div><button className="button primary" type="button" onClick={() => { setEditing(null); setAdding(true); addMutation.reset() }}><Plus size={15} /> Add {definition.noun}</button></header>
    {adding && <RegistryForm definition={formDefinition} saving={addMutation.isPending} onClose={() => setAdding(false)} onSave={addRecord} />}
    {editing && <RegistryForm key={editing.id} definition={formDefinition} initialValues={editing.values} saving={updateMutation.isPending} onClose={() => setEditing(null)} onSave={updateRecord} />}
    {error && <p className="data-error">{error.message}</p>}
    <section className="registry-panel">
      <header><label><Search size={15} /><span className="sr-only">Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLocaleLowerCase()}`} /></label><span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span></header>
      {title === 'Vendors' && <div className="category-tools"><form onSubmit={addCategory}><input value={newCategory} maxLength={100} placeholder="New category" aria-label="New vendor category" onChange={(event) => setNewCategory(event.target.value)} /><button type="submit" disabled={!newCategory.trim() || addCategoryMutation.isPending}><Plus size={12} /> Add</button></form><div className="category-filters" aria-label="Filter vendors by category"><button className={categoryFilter === 'All' ? 'active' : ''} type="button" onClick={() => setCategoryFilter('All')}>All</button>{categories.map((category) => { const categoryRecord = categoryRecords.find((item) => item.name === category); const inUse = records.some((record) => record.values.category.toLocaleLowerCase() === category.toLocaleLowerCase()); const canRemove = Boolean(categoryRecord && (!categoryPersistent || categoryQuery.data)); const isLast = categoryRecords.length === 1; return <span className={`${pillTone(category)}${categoryFilter === category ? ' active' : ''}`} key={category}><button type="button" onClick={() => setCategoryFilter(category)}>{category}</button>{canRemove && <button className="category-remove" type="button" disabled={inUse || isLast || removeCategoryMutation.isPending} title={inUse ? 'Reassign vendors before removing this category' : isLast ? 'Keep at least one vendor category' : `Remove ${category}`} aria-label={`Remove ${category}`} onClick={() => categoryRecord && setPendingDelete({ kind: 'category', category: categoryRecord })}><X size={9} /></button>}</span> })}</div></div>}
      {recordsQuery.isLoading && persistent ? <div className="registry-empty"><p>Loading records...</p></div> : filtered.length ? <div className="registry-list">{filtered.map((record) => { const label = record.values[definition.primaryKey ?? definition.fields[0].key]; return <article key={record.id}><div><strong>{label}</strong>{title === 'Vendors' && <span className={`category-pill ${pillTone(record.values.category)}`}>{record.values.category}</span>}<small>{definition.fields.filter((field) => field.key !== (definition.primaryKey ?? definition.fields[0].key) && (title !== 'Vendors' || field.key !== 'category')).map((field) => record.values[field.key]).filter(Boolean).join(' / ') || `No additional ${definition.noun} details`}</small></div><select className={pillTone(record.status)} value={record.status} onChange={(event) => changeStatus(record, event.target.value)}>{definition.statuses.map((status) => <option key={status}>{status}</option>)}</select><div className="registry-actions"><button type="button" aria-label={`Edit ${definition.noun}`} onClick={() => { setAdding(false); setEditing(record); updateMutation.reset() }}><Pencil size={14} /></button><button className="registry-delete" type="button" aria-label={`Remove ${definition.noun}`} onClick={() => setPendingDelete({ kind: 'record', record, label })}><Trash2 size={14} /></button></div></article> })}</div> : <div className="registry-empty"><Plus size={20} /><h2>No {definition.noun}s yet</h2><p>Add the first record when the information is ready.</p></div>}
    </section>
    {pendingDelete && <ConfirmDialog title={pendingDelete.kind === 'record' ? `Delete ${pendingDelete.label}?` : `Remove ${pendingDelete.category.name}?`} description={pendingDelete.kind === 'record' ? `This ${definition.noun} will be removed from the active workspace.` : 'This category will be removed from the vendor list. It can only be removed while no vendors use it.'} onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />}
  </div>
}

function RegistryForm({ definition, initialValues, saving, onClose, onSave }: { definition: Definition; initialValues?: Record<string, string>; saving: boolean; onClose: () => void; onSave: (values: Record<string, string>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(definition.fields.filter((field) => field.options).map((field) => [field.key, field.options![0]])), ...initialValues }))
  async function submit(event: FormEvent) { event.preventDefault(); const cleanValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])); try { await onSave(cleanValues) } catch { /* Mutation errors are displayed above the registry. */ } }
  return <section className="registry-form"><header><div><p className="eyebrow">{initialValues ? 'Edit record' : 'New record'}</p><h2>{initialValues ? 'Edit' : 'Add'} {definition.noun}</h2></div><button type="button" onClick={onClose} aria-label="Close"><X size={17} /></button></header><form onSubmit={submit}><div>{definition.fields.map((field) => <label key={field.key}><span>{field.label}</span>{field.options ? <select className={pillTone(values[field.key] ?? field.options[0])} required={field.required} value={values[field.key] ?? field.options[0]} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}>{initialValues?.[field.key] && !field.options.includes(initialValues[field.key]) && <option>{initialValues[field.key]}</option>}{field.options.map((value) => <option key={value}>{value}</option>)}</select> : <input type={field.type ?? 'text'} required={field.required} min={field.type === 'number' ? field.min ?? 0 : undefined} step={field.step} value={values[field.key] ?? ''} placeholder={field.placeholder} onChange={(event) => setValues((current) => ({ ...current, [field.key]: field.type === 'file' ? event.target.files?.[0]?.name ?? '' : event.target.value }))} />}</label>)}</div><footer><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></footer></form></section>
}

function ReportsPage() {
  const reports = ['Wedding overview', 'Ceremony summary', 'Budget summary', 'Guest & RSVP report', 'Seating chart', 'Itineraries', 'Packing lists', 'Attire & aso-ebi', 'Traditional requirements', 'Honeymoon itinerary']
  return <div className="page registry-page"><header className="page-header"><div><p className="eyebrow">Exports</p><h1>Reports</h1><p className="page-lead">Create printable planning packs and clean CSV exports from the information in your workspace.</p></div></header><section className="report-grid">{reports.map((report) => <article key={report}><FileText size={18} /><div><strong>{report}</strong><small>PDF report</small></div><button type="button" onClick={() => window.print()}><Download size={15} /> Generate</button></article>)}</section></div>
}

function SettingsPage() {
  return <div className="page registry-page"><header className="page-header"><div><p className="eyebrow">Workspace control</p><h1>Settings</h1><p className="page-lead">Manage ceremony defaults, reporting currency, timezone, reminders, and account details.</p></div></header><section className="settings-grid"><label>Workspace name<input defaultValue="Timmy & Bisola" /></label><label>Reporting currency<select defaultValue="NGN"><option>NGN</option><option>GBP</option><option>USD</option><option>EUR</option></select></label><label>Timezone<input defaultValue="Africa/Lagos" readOnly /></label><label>Weekly summary<select defaultValue="Sunday evening"><option>Sunday evening</option></select></label><button className="button primary" type="button">Save settings</button></section></div>
}
