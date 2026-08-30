import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Circle, MapPin, Pencil, Plus, Trash2, X } from '../components/KoboyoIcon'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { addHoneymoonChecklistItem, addHoneymoonDestination, addHoneymoonDetail, deleteHoneymoonChecklistItem, deleteHoneymoonDestination, deleteHoneymoonDetail, loadHoneymoonChecklist, loadHoneymoonDestinations, loadHoneymoonDetails, setHoneymoonChecklistItemCompleted, updateHoneymoonDestination, updateHoneymoonDestinationStatus, updateHoneymoonDetail, type HoneymoonChecklistItem, type HoneymoonDestination, type HoneymoonDetail } from '../lib/honeymoon-persistence'
import { useWorkspace } from '../lib/workspace-context'
import { pillTone } from '../lib/pills'
import './honeymoon.css'

const destinationStatuses = ['Planning', 'Booked', 'In progress', 'Complete']
const detailTypes = ['Accommodation', 'Activity', 'Transport', 'Flight', 'Other']
const emptyDestination = { location: '', arrivalDate: '', departureDate: '', cost: '' }
const emptyDetail = { title: '', type: detailTypes[0], date: '', cost: '' }

type PendingDelete = { kind: 'destination'; item: HoneymoonDestination } | { kind: 'detail'; item: HoneymoonDetail } | { kind: 'checklist'; item: HoneymoonChecklistItem }

function money(value: string, currency: string) {
  return value ? new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value)) : ''
}

function dateLabel(value: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

export function HoneymoonPage() {
  const { workspace, userId, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const context = { workspaceId: workspace.id, userId, currency: workspace.reporting_currency }
  const destinationKey = ['honeymoon-destinations', workspace.id]
  const detailKey = ['honeymoon-details', workspace.id]
  const checklistKey = ['honeymoon-checklist', workspace.id]
  const [previewDestinations, setPreviewDestinations] = useState<HoneymoonDestination[]>([])
  const [previewDetails, setPreviewDetails] = useState<HoneymoonDetail[]>([])
  const [previewChecklist, setPreviewChecklist] = useState<HoneymoonChecklistItem[]>([])
  const [destinationForm, setDestinationForm] = useState<typeof emptyDestination | null>(null)
  const [editingDestination, setEditingDestination] = useState<HoneymoonDestination | null>(null)
  const [detailDestinationId, setDetailDestinationId] = useState<string | null>(null)
  const [editingDetail, setEditingDetail] = useState<HoneymoonDetail | null>(null)
  const [detailForm, setDetailForm] = useState(emptyDetail)
  const [checklistTitle, setChecklistTitle] = useState('')
  const [checklistDueDate, setChecklistDueDate] = useState('')
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const destinationsQuery = useQuery({ queryKey: destinationKey, enabled: !isPreview, queryFn: () => loadHoneymoonDestinations(workspace.id) })
  const detailsQuery = useQuery({ queryKey: detailKey, enabled: !isPreview, queryFn: () => loadHoneymoonDetails(workspace.id) })
  const checklistQuery = useQuery({ queryKey: checklistKey, enabled: !isPreview, queryFn: () => loadHoneymoonChecklist(workspace.id) })
  const destinationMutation = useMutation({
    mutationFn: ({ id, values }: { id?: string; values: typeof emptyDestination }) => id ? updateHoneymoonDestination(id, values, context) : addHoneymoonDestination(values, context),
    onSuccess: async () => { setDestinationForm(null); setEditingDestination(null); await queryClient.invalidateQueries({ queryKey: destinationKey }) },
  })
  const statusMutation = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => updateHoneymoonDestinationStatus(id, status, context), onSuccess: () => queryClient.invalidateQueries({ queryKey: destinationKey }) })
  const detailMutation = useMutation({
    mutationFn: ({ destinationId, id, values }: { destinationId: string; id?: string; values: typeof emptyDetail }) => id ? updateHoneymoonDetail(id, values, context) : addHoneymoonDetail(destinationId, values, context),
    onSuccess: async () => { setDetailDestinationId(null); setEditingDetail(null); setDetailForm(emptyDetail); await queryClient.invalidateQueries({ queryKey: detailKey }) },
  })
  const deleteDestinationMutation = useMutation({ mutationFn: (id: string) => deleteHoneymoonDestination(id, context), onSuccess: () => queryClient.invalidateQueries({ queryKey: destinationKey }) })
  const deleteDetailMutation = useMutation({ mutationFn: (id: string) => deleteHoneymoonDetail(id, context), onSuccess: () => queryClient.invalidateQueries({ queryKey: detailKey }) })
  const addChecklistMutation = useMutation({ mutationFn: ({ title, dueDate }: { title: string; dueDate: string }) => addHoneymoonChecklistItem(title, dueDate, context), onSuccess: async () => { setChecklistTitle(''); setChecklistDueDate(''); await queryClient.invalidateQueries({ queryKey: checklistKey }) } })
  const completeChecklistMutation = useMutation({ mutationFn: ({ item, completed }: { item: HoneymoonChecklistItem; completed: boolean }) => setHoneymoonChecklistItemCompleted(item.id, completed, context), onSuccess: () => queryClient.invalidateQueries({ queryKey: checklistKey }) })
  const deleteChecklistMutation = useMutation({ mutationFn: (id: string) => deleteHoneymoonChecklistItem(id, context), onSuccess: () => queryClient.invalidateQueries({ queryKey: checklistKey }) })

  const destinations = isPreview ? previewDestinations : destinationsQuery.data ?? []
  const details = isPreview ? previewDetails : detailsQuery.data ?? []
  const checklist = isPreview ? previewChecklist : checklistQuery.data ?? []
  const incompleteCount = checklist.filter((item) => !item.completed).length
  const error = destinationsQuery.error ?? detailsQuery.error ?? checklistQuery.error ?? destinationMutation.error ?? statusMutation.error ?? detailMutation.error ?? deleteDestinationMutation.error ?? deleteDetailMutation.error ?? addChecklistMutation.error ?? completeChecklistMutation.error ?? deleteChecklistMutation.error

  async function saveDestination(event: FormEvent) {
    event.preventDefault()
    if (!destinationForm?.location.trim()) return
    const values = { ...destinationForm, location: destinationForm.location.trim() }
    if (isPreview) {
      if (editingDestination) setPreviewDestinations((current) => current.map((item) => item.id === editingDestination.id ? { ...item, ...values } : item))
      else setPreviewDestinations((current) => [...current, { id: crypto.randomUUID(), ...values, status: 'Planning' }])
      setDestinationForm(null)
      setEditingDestination(null)
      return
    }
    try { await destinationMutation.mutateAsync({ id: editingDestination?.id, values }) } catch { /* Displayed below the header. */ }
  }

  async function saveDetail(event: FormEvent) {
    event.preventDefault()
    if (!detailDestinationId || !detailForm.title.trim()) return
    const values = { ...detailForm, title: detailForm.title.trim() }
    if (isPreview) {
      if (editingDetail) setPreviewDetails((current) => current.map((item) => item.id === editingDetail.id ? { ...item, ...values } : item))
      else setPreviewDetails((current) => [...current, { id: crypto.randomUUID(), destinationId: detailDestinationId, ...values }])
      setDetailDestinationId(null)
      setEditingDetail(null)
      setDetailForm(emptyDetail)
      return
    }
    try { await detailMutation.mutateAsync({ destinationId: detailDestinationId, id: editingDetail?.id, values }) } catch { /* Displayed below the header. */ }
  }

  function changeStatus(item: HoneymoonDestination, status: string) {
    if (isPreview) setPreviewDestinations((current) => current.map((destination) => destination.id === item.id ? { ...destination, status } : destination))
    else statusMutation.mutate({ id: item.id, status })
  }

  function addChecklistItem(event: FormEvent) {
    event.preventDefault()
    const title = checklistTitle.trim()
    if (!title || !destinations.length) return
    if (isPreview) {
      setPreviewChecklist((current) => [...current, { id: crypto.randomUUID(), title, dueDate: checklistDueDate, completed: false }])
      setChecklistTitle('')
      setChecklistDueDate('')
    } else addChecklistMutation.mutate({ title, dueDate: checklistDueDate })
  }

  function toggleChecklistItem(item: HoneymoonChecklistItem) {
    if (isPreview) setPreviewChecklist((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, completed: !currentItem.completed } : currentItem))
    else completeChecklistMutation.mutate({ item, completed: !item.completed })
  }

  function confirmDelete() {
    if (!pendingDelete) return
    if (pendingDelete.kind === 'destination') {
      if (isPreview) { setPreviewDestinations((current) => current.filter((item) => item.id !== pendingDelete.item.id)); setPreviewDetails((current) => current.filter((item) => item.destinationId !== pendingDelete.item.id)) }
      else deleteDestinationMutation.mutate(pendingDelete.item.id)
    } else if (pendingDelete.kind === 'detail') {
      if (isPreview) setPreviewDetails((current) => current.filter((item) => item.id !== pendingDelete.item.id))
      else deleteDetailMutation.mutate(pendingDelete.item.id)
    } else {
      if (isPreview) setPreviewChecklist((current) => current.filter((item) => item.id !== pendingDelete.item.id))
      else deleteChecklistMutation.mutate(pendingDelete.item.id)
    }
    setPendingDelete(null)
  }

  return <div className="page honeymoon-page ui-page">
    <header className="page-header"><div><p className="eyebrow">Travel planning</p><h1>Honeymoon</h1><p className="page-lead">Plan each destination, then keep its accommodation, activities, and travel details together.</p></div><button className="button primary" type="button" onClick={() => { setEditingDestination(null); setDestinationForm({ ...emptyDestination }) }}><Plus size={15} /> Add location</button></header>
    {destinationForm && <section className="honeymoon-form"><header><div><p className="eyebrow">{editingDestination ? 'Edit destination' : 'New destination'}</p><h2>{editingDestination ? 'Update location' : 'Add a location'}</h2></div><button type="button" aria-label="Close" onClick={() => setDestinationForm(null)}><X size={17} /></button></header><form onSubmit={saveDestination}><label><span>Location</span><input required maxLength={160} value={destinationForm.location} placeholder="e.g. Zanzibar" onChange={(event) => setDestinationForm((current) => current && ({ ...current, location: event.target.value }))} /></label><label><span>Arrival date</span><input type="date" value={destinationForm.arrivalDate} onChange={(event) => setDestinationForm((current) => current && ({ ...current, arrivalDate: event.target.value }))} /></label><label><span>Departure date</span><input type="date" min={destinationForm.arrivalDate || undefined} value={destinationForm.departureDate} onChange={(event) => setDestinationForm((current) => current && ({ ...current, departureDate: event.target.value }))} /></label><label><span>Estimated cost ({workspace.reporting_currency})</span><input type="number" min="0" step="0.01" value={destinationForm.cost} onChange={(event) => setDestinationForm((current) => current && ({ ...current, cost: event.target.value }))} /></label><footer><button className="button secondary" type="button" onClick={() => setDestinationForm(null)}>Cancel</button><button className="button primary" type="submit" disabled={destinationMutation.isPending}>{destinationMutation.isPending ? 'Saving...' : 'Save location'}</button></footer></form></section>}
    {error && <p className="data-error">{error.message}</p>}
    {destinationsQuery.isLoading && !isPreview ? <section className="honeymoon-empty"><p>Loading destinations...</p></section> : destinations.length ? <section className="honeymoon-destinations">{destinations.map((destination) => { const destinationDetails = details.filter((detail) => detail.destinationId === destination.id); return <article className="honeymoon-destination" key={destination.id}><header><div className="honeymoon-location-icon"><MapPin size={18} /></div><div><h2>{destination.location}</h2><p>{destination.arrivalDate || destination.departureDate ? `${dateLabel(destination.arrivalDate) || 'Date to be decided'} to ${dateLabel(destination.departureDate) || 'Date to be decided'}` : 'Travel dates to be decided'}{destination.cost && ` / ${money(destination.cost, workspace.reporting_currency)}`}</p></div><select className={pillTone(destination.status)} value={destination.status} onChange={(event) => changeStatus(destination, event.target.value)}>{destinationStatuses.map((status) => <option key={status}>{status}</option>)}</select><div className="honeymoon-actions"><button type="button" aria-label={`Edit ${destination.location}`} onClick={() => { setEditingDestination(destination); setDestinationForm({ location: destination.location, arrivalDate: destination.arrivalDate, departureDate: destination.departureDate, cost: destination.cost }) }}><Pencil size={14} /></button><button type="button" aria-label={`Remove ${destination.location}`} onClick={() => setPendingDelete({ kind: 'destination', item: destination })}><Trash2 size={14} /></button></div></header><div className="honeymoon-details"><div className="honeymoon-details-heading"><div><strong>Location details</strong><span>{destinationDetails.length} item{destinationDetails.length === 1 ? '' : 's'}</span></div><button type="button" onClick={() => { setDetailDestinationId(destination.id); setEditingDetail(null); setDetailForm(emptyDetail) }}><Plus size={12} /> Add detail</button></div>{detailDestinationId === destination.id && <form className="honeymoon-detail-form" onSubmit={saveDetail}><label><span>Detail</span><input required maxLength={160} value={detailForm.title} placeholder="e.g. Beachfront hotel" onChange={(event) => setDetailForm((current) => ({ ...current, title: event.target.value }))} /></label><label><span>Type</span><select value={detailForm.type} onChange={(event) => setDetailForm((current) => ({ ...current, type: event.target.value }))}>{detailTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label><span>Date</span><input type="date" value={detailForm.date} onChange={(event) => setDetailForm((current) => ({ ...current, date: event.target.value }))} /></label><label><span>Cost</span><input type="number" min="0" step="0.01" value={detailForm.cost} onChange={(event) => setDetailForm((current) => ({ ...current, cost: event.target.value }))} /></label><div><button className="button secondary" type="button" onClick={() => { setDetailDestinationId(null); setEditingDetail(null) }}>Cancel</button><button className="button primary" type="submit" disabled={detailMutation.isPending}>{detailMutation.isPending ? 'Saving...' : editingDetail ? 'Save' : 'Add'}</button></div></form>}{destinationDetails.length ? <div className="honeymoon-detail-list">{destinationDetails.map((detail) => <div key={detail.id}><span className={`category-pill ${pillTone(detail.type)}`}>{detail.type}</span><strong>{detail.title}</strong><small>{[dateLabel(detail.date), money(detail.cost, workspace.reporting_currency)].filter(Boolean).join(' / ') || 'No date or cost added'}</small><span className="honeymoon-detail-actions"><button type="button" aria-label={`Edit ${detail.title}`} onClick={() => { setDetailDestinationId(destination.id); setEditingDetail(detail); setDetailForm({ title: detail.title, type: detail.type, date: detail.date, cost: detail.cost }) }}><Pencil size={13} /></button><button type="button" aria-label={`Remove ${detail.title}`} onClick={() => setPendingDelete({ kind: 'detail', item: detail })}><Trash2 size={13} /></button></span></div>)}</div> : detailDestinationId !== destination.id && <p className="honeymoon-details-empty">Add accommodation, activities, transport, or other plans for this location.</p>}</div></article> })}</section> : <section className="honeymoon-empty"><MapPin size={22} /><h2>No locations yet</h2><p>Add the first destination on your honeymoon route.</p></section>}
    <section className="honeymoon-checklist"><header><div><p className="eyebrow">Before you travel</p><h2>Honeymoon checklist</h2><p>Keep track of the practical things you still need to sort out.</p></div><span>{incompleteCount} to do</span></header><form onSubmit={addChecklistItem}><label><span className="sr-only">Checklist item</span><input required maxLength={160} disabled={!destinations.length} value={checklistTitle} placeholder={destinations.length ? 'e.g. Apply for visas' : 'Add a location first'} onChange={(event) => setChecklistTitle(event.target.value)} /></label><label><span className="sr-only">Due date</span><input type="date" disabled={!destinations.length} value={checklistDueDate} onChange={(event) => setChecklistDueDate(event.target.value)} /></label><button className="button primary" type="submit" disabled={!destinations.length || !checklistTitle.trim() || addChecklistMutation.isPending}><Plus size={14} /> Add item</button></form>{checklistQuery.isLoading && !isPreview ? <p className="honeymoon-checklist-empty">Loading checklist...</p> : checklist.length ? <div className="honeymoon-checklist-list">{checklist.map((item) => <article className={item.completed ? 'completed' : ''} key={item.id}><button className="honeymoon-check-toggle" type="button" aria-label={`${item.completed ? 'Mark incomplete' : 'Mark complete'}: ${item.title}`} onClick={() => toggleChecklistItem(item)}>{item.completed ? <Check size={14} /> : <Circle size={14} />}</button><div><strong>{item.title}</strong>{item.dueDate && <small>Due {dateLabel(item.dueDate)}</small>}</div><button className="honeymoon-check-delete" type="button" aria-label={`Remove ${item.title}`} onClick={() => setPendingDelete({ kind: 'checklist', item })}><Trash2 size={14} /></button></article>)}</div> : <p className="honeymoon-checklist-empty">No checklist items yet.</p>}</section>
    {pendingDelete && <ConfirmDialog title={`Remove ${pendingDelete.kind === 'destination' ? pendingDelete.item.location : pendingDelete.item.title}?`} description={pendingDelete.kind === 'destination' ? 'This location and its visible details will be removed from the honeymoon plan.' : 'This item will be removed from the honeymoon plan.'} pending={deleteDestinationMutation.isPending || deleteDetailMutation.isPending || deleteChecklistMutation.isPending} onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />}
  </div>
}
