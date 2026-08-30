import { useDeferredValue, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload as TusUpload } from 'tus-js-client'
import { ArrowUpRight, Download, FileImage, FileText, Pencil, Plus, Search, Trash2, Upload, X } from '../components/KoboyoIcon'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { VendorRateCardViewer, type VendorRateCard } from '../components/VendorRateCardViewer'
import { addRegistryRecord, loadCeremonies, loadRegistry, softDeleteRegistry, updateRegistryRecord, updateRegistryStatus, type RegistryRecord, type RegistryTitle } from '../lib/registry-persistence'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import { pillTone } from '../lib/pills'
import { HoneymoonPage } from './HoneymoonPage'
import './registry.css'

type Field = { key: string; label: string; type?: 'text' | 'tel' | 'url' | 'date' | 'time' | 'number' | 'file'; options?: string[]; placeholder?: string; required?: boolean; min?: number; step?: number }
type Definition = { eyebrow: string; description: string; noun: string; fields: Field[]; statuses: string[]; primaryKey?: string }
type VendorCategory = { id: string; name: string; position: number }

const rateCardTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const maxRateCardSize = 25 * 1024 * 1024

function rateCardMimeType(file: File) {
  if (rateCardTypes.has(file.type)) return file.type
  const extension = file.name.split('.').pop()?.toLocaleLowerCase()
  return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[extension ?? '']
}

async function uploadRateCard(storagePath: string, file: File, mimeType: string, onProgress: (percentage: number) => void) {
  const { data, error } = await supabase!.auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('Your session expired. Sign in again before uploading.')
  const projectUrl = import.meta.env.VITE_SUPABASE_URL as string
  const projectId = new URL(projectUrl).hostname.split('.')[0]

  await new Promise<void>((resolve, reject) => {
    const upload = new TusUpload(file, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000],
      headers: { authorization: `Bearer ${data.session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: { bucketName: 'wedding-files', objectName: storagePath, contentType: mimeType, cacheControl: '3600' },
      onProgress: (uploaded, total) => onProgress(total ? Math.round((uploaded / total) * 100) : 0),
      onError: reject,
      onSuccess: () => { onProgress(100); resolve() },
    })
    upload.start()
  })
}

const eventField: Field = { key: 'event', label: 'Ceremony', options: ['Court', 'Traditional', 'White', 'General / shared'] }
const requiredEventField: Field = { ...eventField, required: true, options: ['Court', 'Traditional', 'White'] }
const defaultVendorCategories = ['Hall', 'Cars', 'Hotels', 'Tailor', 'Food', 'Drinks', 'Photography', 'Videography', 'Decor', 'Entertainment', 'Beauty', 'Cake', 'Invitations', 'Security', 'Rentals', 'Gifts', 'Other']
const vendorStatusPriority: Record<string, number> = { selected: 0, shortlisted: 1, considering: 2, declined: 3 }

const definitions: Record<string, Definition> = {
  Calendar: { eyebrow: 'Schedule', description: 'See ceremonies, appointments, payments, and planning deadlines together.', noun: 'calendar entry', fields: [{ key: 'title', label: 'Entry title', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'time', label: 'Time', type: 'time' }, { key: 'type', label: 'Type', options: ['Task', 'Appointment', 'Payment', 'Personal'] }, eventField], statuses: ['Scheduled', 'Complete', 'Cancelled'] },
  Itineraries: { eyebrow: 'Run of show', description: 'Build ordered schedules for every part of each celebration.', noun: 'itinerary item', fields: [{ key: 'activity', label: 'Activity', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'time', label: 'Time', type: 'time' }, { key: 'location', label: 'Location' }, { key: 'owner', label: 'Person responsible' }, requiredEventField], statuses: ['Planned', 'Confirmed', 'Complete'] },
  Seating: { eyebrow: 'Traditional & White', description: 'Create tables and capacities before assigning confirmed guests.', noun: 'table', fields: [{ key: 'name', label: 'Table name' }, { key: 'capacity', label: 'Capacity', type: 'number' }, { key: 'area', label: 'Area or section' }, { ...eventField, options: ['Traditional', 'White'] }], statuses: ['Open', 'Locked'] },
  Vendors: { eyebrow: 'Supplier directory', description: 'Compare suppliers, packages, contacts, contracts, and balances.', noun: 'vendor', fields: [{ key: 'name', label: 'Company name', required: true }, { key: 'category', label: 'Category', required: true, options: defaultVendorCategories }, { key: 'link', label: 'Portfolio / social link', type: 'url', placeholder: 'https://...' }, { key: 'contact', label: 'Contact person' }, { key: 'phone', label: 'Phone', type: 'tel' }, { key: 'quote', label: 'Quote / package' }, eventField], statuses: ['Considering', 'Shortlisted', 'Selected', 'Declined'] },
  Venues: { eyebrow: 'Location shortlist', description: 'Compare capacity, availability, inclusions, costs, and selection status.', noun: 'venue', fields: [{ key: 'name', label: 'Venue name', required: true }, { key: 'location', label: 'Location' }, { key: 'capacity', label: 'Capacity', type: 'number' }, { key: 'cost', label: 'Estimated cost', type: 'number', step: 0.01 }, { key: 'availability', label: 'Available date', type: 'date' }, eventField], statuses: ['Considering', 'Viewing booked', 'Shortlisted', 'Selected'] },
  'Food & drinks': { eyebrow: 'Menu planning', description: 'Plan menus, drinks, quantities, caterers, tastings, and package costs.', noun: 'menu item', fields: [{ key: 'name', label: 'Item or package', required: true }, { key: 'category', label: 'Category', options: ['Food', 'Drink', 'Cake', 'Service'] }, { key: 'vendor', label: 'Caterer / bartender' }, { key: 'quantity', label: 'Quantity', type: 'number' }, { key: 'cost', label: 'Estimated cost', type: 'number', step: 0.01 }, requiredEventField], statuses: ['Idea', 'Tasting', 'Approved', 'Ordered'] },
  'Wedding party': { eyebrow: 'People & roles', description: 'Coordinate roles, ceremony participation, responsibilities, and outfits.', noun: 'party member', fields: [{ key: 'name', label: 'Name', required: true }, { key: 'role', label: 'Role', required: true }, { key: 'phone', label: 'Phone', type: 'tel' }, { key: 'order', label: 'Processional order', type: 'number' }, { key: 'responsibility', label: 'Responsibility' }, eventField], statuses: ['Invited', 'Confirmed', 'Ready'] },
  Packing: { eyebrow: 'Packing lists', description: 'Prepare ceremony, wedding-weekend, and honeymoon packing lists.', noun: 'packing item', fields: [{ key: 'item', label: 'Item', required: true }, { key: 'category', label: 'Category', required: true }, { key: 'quantity', label: 'Quantity', type: 'number', min: 1 }, { key: 'owner', label: 'Person responsible' }, eventField], statuses: ['Not packed', 'Packed'] },
  Gifts: { eyebrow: 'Gifts & thanks', description: 'Record gifts, cash amounts, ceremony links, and thank-you progress.', noun: 'gift', primaryKey: 'description', fields: [{ key: 'guest', label: 'Guest' }, { key: 'description', label: 'Gift description', required: true }, { key: 'type', label: 'Type', options: ['Gift', 'Cash'] }, { key: 'amount', label: 'Cash amount', type: 'number', step: 0.01 }, { key: 'currency', label: 'Currency', options: ['NGN', 'GBP', 'USD', 'EUR'] }, eventField], statuses: ['Received', 'Thank-you due', 'Thank-you sent'] },
  'Photos & files': { eyebrow: 'Private library', description: 'Keep inspiration, receipts, contracts, images, and wedding documents private.', noun: 'file', fields: [{ key: 'name', label: 'Title' }, { key: 'category', label: 'Category', options: ['Photo', 'Inspiration', 'Receipt', 'Contract', 'Quote', 'Invitation', 'Travel'] }, { key: 'file', label: 'Choose file', type: 'file' }, eventField], statuses: ['Active', 'Archived'] },
}

const persistedTitles = new Set<RegistryTitle>(['Calendar', 'Itineraries', 'Vendors', 'Venues', 'Food & drinks', 'Wedding party', 'Packing', 'Gifts'])

function isRegistryTitle(title: string): title is RegistryTitle {
  return persistedTitles.has(title as RegistryTitle)
}

export function ModulePage({ title }: { title: string }) {
  if (title === 'Reports') return <ReportsPage />
  if (title === 'Settings') return <SettingsPage />
  if (title === 'Honeymoon') return <HoneymoonPage />
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
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'record'; record: RegistryRecord; label: string } | { kind: 'category'; category: VendorCategory } | { kind: 'rate-card'; file: VendorRateCard } | null>(null)
  const [viewingRateCard, setViewingRateCard] = useState<VendorRateCard | null>(null)
  const [uploadProgress, setUploadProgress] = useState<{ fileName: string; current: number; total: number; percentage: number } | null>(null)
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
  const rateCardsQuery = useQuery({
    queryKey: ['vendor-rate-cards', workspace.id],
    enabled: categoryPersistent,
    queryFn: async () => {
      const { data, error } = await supabase!.from('files').select('id,vendor_id,storage_path,original_name,mime_type,size_bytes').eq('workspace_id', workspace.id).eq('category', 'Rate card').is('deleted_at', null).order('created_at', { ascending: false })
      if (error) throw error
      return data as VendorRateCard[]
    },
  })
  const uploadRateCardsMutation = useMutation({
    mutationFn: async ({ vendorId, files }: { vendorId: string; files: File[] }) => {
      for (const [index, file] of files.entries()) {
        const progress = (percentage: number) => setUploadProgress({ fileName: file.name, current: index + 1, total: files.length, percentage })
        progress(0)
        const mimeType = rateCardMimeType(file)
        if (!mimeType) throw new Error(`${file.name} must be a PDF, JPEG, PNG, or WebP image.`)
        if (file.size > maxRateCardSize) throw new Error(`${file.name} is larger than 25 MB.`)
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
        const storagePath = `${workspace.id}/vendors/${vendorId}/rate-cards/${crypto.randomUUID()}-${safeName}`
        await uploadRateCard(storagePath, file, mimeType, progress)
        const { error } = await supabase!.from('files').insert({ workspace_id: workspace.id, vendor_id: vendorId, bucket_id: 'wedding-files', storage_path: storagePath, original_name: file.name, mime_type: mimeType, size_bytes: file.size, category: 'Rate card', uploaded_by: userId, created_by: userId, updated_by: userId })
        if (error) {
          await supabase!.storage.from('wedding-files').remove([storagePath])
          throw error
        }
      }
    },
    onSettled: () => { setUploadProgress(null); return queryClient.invalidateQueries({ queryKey: ['vendor-rate-cards', workspace.id] }) },
  })
  const deleteRateCardMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase!.from('files').update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq('workspace_id', workspace.id).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendor-rate-cards', workspace.id] }),
  })
  const addMutation = useMutation({
    mutationFn: (values: Record<string, string>) => addRegistryRecord(title as RegistryTitle, values, { workspaceId: workspace.id, userId, currency: workspace.reporting_currency, ceremonies: ceremoniesQuery.data ?? [] }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['registry', title, workspace.id] }) },
  })
  const statusMutation = useMutation({
    mutationFn: ({ record, status }: { record: RegistryRecord; status: string }) => updateRegistryStatus(title as RegistryTitle, record, status, workspace.id, userId),
    onMutate: async ({ record, status }) => {
      const queryKey = ['registry', title, workspace.id]
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<RegistryRecord[]>(queryKey)
      queryClient.setQueryData<RegistryRecord[]>(queryKey, (current) => current?.map((item) => item.id === record.id ? { ...item, status } : item))
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(['registry', title, workspace.id], context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['registry', title, workspace.id] }),
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
  const filtered = records
    .filter((record) => Object.values(record.values).join(' ').toLocaleLowerCase().includes(deferredQuery) && (categoryFilter === 'All' || record.values.category === categoryFilter))
    .map((record, index) => ({ record, index }))
    .sort((a, b) => title === 'Vendors' ? (vendorStatusPriority[a.record.status.toLocaleLowerCase()] ?? 4) - (vendorStatusPriority[b.record.status.toLocaleLowerCase()] ?? 4) || a.index - b.index : a.index - b.index)
    .map(({ record }) => record)
  const error = recordsQuery.error ?? ceremoniesQuery.error ?? categoryQuery.error ?? rateCardsQuery.error ?? addMutation.error ?? updateMutation.error ?? statusMutation.error ?? deleteMutation.error ?? addCategoryMutation.error ?? removeCategoryMutation.error ?? uploadRateCardsMutation.error ?? deleteRateCardMutation.error

  async function addRecord(values: Record<string, string>, rateCards: File[]) {
    if (!persistent) {
      setPreviewRecords((current) => [{ id: crypto.randomUUID(), values, status: definition.statuses[0] }, ...current])
      setAdding(false)
      return
    }
    const recordId = await addMutation.mutateAsync(values)
    try {
      if (title === 'Vendors' && recordId && rateCards.length) await uploadRateCardsMutation.mutateAsync({ vendorId: recordId, files: rateCards })
    } finally {
      // The vendor already exists even if an attachment fails; close to prevent duplicate retries.
      setAdding(false)
    }
  }

  async function updateRecord(values: Record<string, string>, rateCards: File[]) {
    if (!editing) return
    if (!persistent) {
      setPreviewRecords((current) => current.map((record) => record.id === editing.id ? { ...record, values } : record))
      setEditing(null)
      return
    }
    await updateMutation.mutateAsync({ record: editing, values })
    if (title === 'Vendors' && rateCards.length) await uploadRateCardsMutation.mutateAsync({ vendorId: editing.id, files: rateCards })
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
    else if (pendingDelete.kind === 'category') removeCategory(pendingDelete.category)
    else deleteRateCardMutation.mutate(pendingDelete.file.id)
    setPendingDelete(null)
  }

  return <div className={`page registry-page ui-page${title === 'Vendors' ? ' vendors-page' : ''}`}>
    <header className="page-header"><div><p className="eyebrow">{definition.eyebrow}</p><h1>{title}</h1><p className="page-lead">{definition.description}</p></div><button className="button primary" type="button" onClick={() => { setEditing(null); setAdding(true); addMutation.reset() }}><Plus size={15} /> Add {definition.noun}</button></header>
    {adding && <RegistryForm definition={formDefinition} allowRateCards={title === 'Vendors'} saving={addMutation.isPending || uploadRateCardsMutation.isPending} onClose={() => setAdding(false)} onSave={addRecord} />}
    {editing && <RegistryForm key={editing.id} definition={formDefinition} initialValues={editing.values} allowRateCards={title === 'Vendors'} saving={updateMutation.isPending || uploadRateCardsMutation.isPending} onClose={() => setEditing(null)} onSave={updateRecord} />}
    {error && <p className="data-error">{error.message}</p>}
    <section className="registry-panel">
      <header><div className="registry-search-controls"><label><Search size={15} /><span className="sr-only">Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLocaleLowerCase()}`} /></label>{title === 'Vendors' && <label className="vendor-category-select"><span className="sr-only">Filter vendors by category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option>All</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>}</div><span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span></header>
      {title === 'Vendors' && <div className="category-tools"><form onSubmit={addCategory}><input value={newCategory} maxLength={100} placeholder="New category" aria-label="New vendor category" onChange={(event) => setNewCategory(event.target.value)} /><button type="submit" disabled={!newCategory.trim() || addCategoryMutation.isPending}><Plus size={12} /> Add</button></form><div className="category-filters" aria-label="Filter vendors by category"><button className={categoryFilter === 'All' ? 'active' : ''} type="button" onClick={() => setCategoryFilter('All')}>All</button>{categories.map((category) => { const categoryRecord = categoryRecords.find((item) => item.name === category); const inUse = records.some((record) => record.values.category.toLocaleLowerCase() === category.toLocaleLowerCase()); const canRemove = Boolean(categoryRecord && (!categoryPersistent || categoryQuery.data)); const isLast = categoryRecords.length === 1; return <span className={`${pillTone(category)}${categoryFilter === category ? ' active' : ''}`} key={category}><button type="button" onClick={() => setCategoryFilter(category)}>{category}</button>{canRemove && <button className="category-remove" type="button" disabled={inUse || isLast || removeCategoryMutation.isPending} title={inUse ? 'Reassign vendors before removing this category' : isLast ? 'Keep at least one vendor category' : `Remove ${category}`} aria-label={`Remove ${category}`} onClick={() => categoryRecord && setPendingDelete({ kind: 'category', category: categoryRecord })}><X size={9} /></button>}</span> })}</div></div>}
      {recordsQuery.isLoading && persistent ? <div className="registry-empty"><p>Loading records...</p></div> : filtered.length ? <div className="registry-list">{filtered.map((record) => { const label = record.values[definition.primaryKey ?? definition.fields[0].key]; const rateCards = title === 'Vendors' ? (rateCardsQuery.data ?? []).filter((file) => file.vendor_id === record.id) : []; return <article key={record.id}><div><strong>{label}</strong>{title === 'Vendors' && <span className={`category-pill ${pillTone(record.values.category)}`}>{record.values.category}</span>}{title === 'Vendors' && record.values.link && <a className="vendor-link" href={record.values.link} target="_blank" rel="noreferrer">View work <ArrowUpRight size={11} /></a>}<small>{definition.fields.filter((field) => field.key !== (definition.primaryKey ?? definition.fields[0].key) && (title !== 'Vendors' || !['category', 'link'].includes(field.key))).map((field) => record.values[field.key]).filter(Boolean).join(' / ') || `No additional ${definition.noun} details`}</small>{title === 'Vendors' && <div className="vendor-rate-cards">{rateCards.map((file) => <span className="vendor-rate-card" key={file.id}><button type="button" title={`View ${file.original_name}`} onClick={() => setViewingRateCard(file)}>{file.mime_type.startsWith('image/') ? <FileImage size={12} /> : <FileText size={12} />}<span>{file.original_name}</span></button><button type="button" aria-label={`Remove ${file.original_name}`} onClick={() => setPendingDelete({ kind: 'rate-card', file })}><X size={10} /></button></span>)}<label className={`vendor-rate-card-upload${uploadRateCardsMutation.isPending ? ' disabled' : ''}`}><Upload size={12} /><span>{rateCards.length ? 'Add another' : 'Add rate card'}</span><input type="file" multiple disabled={uploadRateCardsMutation.isPending} accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) uploadRateCardsMutation.mutate({ vendorId: record.id, files }); event.currentTarget.value = '' }} /></label></div>}</div><select className={pillTone(record.status)} value={record.status} onChange={(event) => changeStatus(record, event.target.value)}>{definition.statuses.map((status) => <option key={status}>{status}</option>)}</select><div className="registry-actions"><button type="button" aria-label={`Edit ${definition.noun}`} onClick={() => { setAdding(false); setEditing(record); updateMutation.reset() }}><Pencil size={14} /></button><button className="registry-delete" type="button" aria-label={`Remove ${definition.noun}`} onClick={() => setPendingDelete({ kind: 'record', record, label })}><Trash2 size={14} /></button></div></article> })}</div> : <div className="registry-empty"><Plus size={20} /><h2>No {definition.noun}s yet</h2><p>Add the first record when the information is ready.</p></div>}
    </section>
    {pendingDelete && <ConfirmDialog title={pendingDelete.kind === 'record' ? `Delete ${pendingDelete.label}?` : pendingDelete.kind === 'category' ? `Remove ${pendingDelete.category.name}?` : `Remove ${pendingDelete.file.original_name}?`} description={pendingDelete.kind === 'record' ? `This ${definition.noun} will be removed from the active workspace.` : pendingDelete.kind === 'category' ? 'This category will be removed from the vendor list. It can only be removed while no vendors use it.' : 'This rate card will move to the recycle bin. Its private file will remain available for recovery.'} onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />}
    {viewingRateCard && <VendorRateCardViewer file={viewingRateCard} onClose={() => setViewingRateCard(null)} />}
    {uploadProgress && <aside className="rate-card-upload-status" role="status" aria-live="polite"><span className="rate-card-upload-percentage">{uploadProgress.percentage}%</span><div><strong>Uploading rate card {uploadProgress.current} of {uploadProgress.total}</strong><p>{uploadProgress.fileName}</p><span className="rate-card-upload-track"><span style={{ width: `${uploadProgress.percentage}%` }} /></span></div></aside>}
  </div>
}

function RegistryForm({ definition, initialValues, allowRateCards = false, saving, onClose, onSave }: { definition: Definition; initialValues?: Record<string, string>; allowRateCards?: boolean; saving: boolean; onClose: () => void; onSave: (values: Record<string, string>, rateCards: File[]) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(definition.fields.filter((field) => field.options).map((field) => [field.key, field.options![0]])), ...initialValues }))
  const [rateCards, setRateCards] = useState<File[]>([])
  async function submit(event: FormEvent) { event.preventDefault(); const cleanValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])); try { await onSave(cleanValues, rateCards) } catch { /* Mutation errors are displayed above the registry. */ } }
  return <section className="registry-form"><header><div><p className="eyebrow">{initialValues ? 'Edit record' : 'New record'}</p><h2>{initialValues ? 'Edit' : 'Add'} {definition.noun}</h2></div><button type="button" onClick={onClose} aria-label="Close"><X size={17} /></button></header><form onSubmit={submit}><div>{definition.fields.map((field) => <label key={field.key}><span>{field.label}</span>{field.options ? <select required={field.required} value={values[field.key] ?? field.options[0]} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}>{initialValues?.[field.key] && !field.options.includes(initialValues[field.key]) && <option>{initialValues[field.key]}</option>}{field.options.map((value) => <option key={value}>{value}</option>)}</select> : <input type={field.type ?? 'text'} required={field.required} min={field.type === 'number' ? field.min ?? 0 : undefined} step={field.step} pattern={field.key === 'phone' ? "\\+?[0-9][0-9 ()-]{6,19}" : undefined} title={field.key === 'phone' ? 'Enter a valid phone number with 7 to 20 digits and common separators.' : undefined} maxLength={field.type === 'url' ? 2048 : field.type === 'number' ? undefined : 160} value={values[field.key] ?? ''} placeholder={field.placeholder} onChange={(event) => setValues((current) => ({ ...current, [field.key]: field.type === 'file' ? event.target.files?.[0]?.name ?? '' : event.target.value }))} />}</label>)}{allowRateCards && <label className="rate-card-picker"><span>Rate cards <small>PDF or image, up to 25 MB each</small></span><input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setRateCards(Array.from(event.target.files ?? []))} /><strong>{rateCards.length ? rateCards.map((file) => file.name).join(', ') : initialValues ? 'Add more rate cards' : 'Choose rate cards'}</strong></label>}</div><footer><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></footer></form></section>
}

function ReportsPage() {
  const reports = ['Wedding overview', 'Ceremony summary', 'Budget summary', 'Guest & RSVP report', 'Seating chart', 'Itineraries', 'Packing lists', 'Attire & aso-ebi', 'Traditional requirements', 'Honeymoon itinerary']
  return <div className="page registry-page ui-page"><header className="page-header"><div><p className="eyebrow">Exports</p><h1>Reports</h1><p className="page-lead">Create printable planning packs and clean CSV exports from the information in your workspace.</p></div></header><section className="report-grid">{reports.map((report) => <article key={report}><FileText size={18} /><div><strong>{report}</strong><small>PDF report</small></div><button type="button" onClick={() => window.print()}><Download size={15} /> Generate</button></article>)}</section></div>
}

function SettingsPage() {
  return <div className="page registry-page ui-page"><header className="page-header"><div><p className="eyebrow">Workspace control</p><h1>Settings</h1><p className="page-lead">Manage ceremony defaults, reporting currency, timezone, reminders, and account details.</p></div></header><section className="settings-grid"><label>Workspace name<input defaultValue="Timmy & Bisola" /></label><label>Reporting currency<select defaultValue="NGN"><option>NGN</option><option>GBP</option><option>USD</option><option>EUR</option></select></label><label>Timezone<input defaultValue="Africa/Lagos" readOnly /></label><label>Weekly summary<select defaultValue="Sunday evening"><option>Sunday evening</option></select></label><button className="button primary" type="button">Save settings</button></section></div>
}
