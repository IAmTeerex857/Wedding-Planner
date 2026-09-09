import { CalendarDays, Clock3, MapPin, Pencil, Plus, Trash2, Users } from '../components/KoboyoIcon'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Modal } from '../components/Modal'
import { pillTone } from '../lib/pills'
import { useCreateParam } from '../lib/use-create-param'
import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import './planning.css'

export type CeremonyStatus = 'tentative' | 'confirmed' | 'completed' | 'cancelled'

export interface CeremonySegment {
  id: string
  title: string
  time: string
}

export interface Ceremony {
  id: string
  databaseId?: string
  kind: string
  name: string
  status: CeremonyStatus
  date: string
  location: string
  capacity: number | null
  segments: CeremonySegment[]
}

const initialCeremonies: Ceremony[] = [
  { id: 'court', kind: 'court', name: 'Court', status: 'tentative', date: '', location: '', capacity: null, segments: [] },
  { id: 'traditional', kind: 'traditional', name: 'Traditional', status: 'tentative', date: '', location: '', capacity: null, segments: [] },
  { id: 'white', kind: 'white', name: 'White', status: 'tentative', date: '', location: '', capacity: null, segments: [] },
]

const statusOptions: Array<{ value: CeremonyStatus; label: string }> = [
  { value: 'tentative', label: 'Tentative' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export function CeremoniesPage() {
  const { workspace, userId, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const [ceremonies, setCeremonies] = useState<Ceremony[]>(initialCeremonies)
  const [draft, setDraft] = useState<Ceremony | null>(null)
  const [draftIsNew, setDraftIsNew] = useState(false)
  const [pendingCeremonyDelete, setPendingCeremonyDelete] = useState<Ceremony | null>(null)
  const ceremonyQuery = useQuery({
    queryKey: ['ceremonies', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const { data, error } = await supabase!.from('ceremonies').select('id,kind,name,status,starts_at,location_name,guest_capacity,ceremony_segments(id,name,starts_at,position,deleted_at)').eq('workspace_id', workspace.id).is('deleted_at', null).order('created_at')
      if (error) throw error
      return data
    },
  })
  const saveMutation = useMutation({
    mutationFn: async (ceremony: Ceremony) => {
      if (isPreview) return
      const label = ceremony.name.trim()
      if (!label) throw new Error('Enter a ceremony name.')
      const startsAt = ceremony.date ? new Date(`${ceremony.date}T12:00:00+01:00`).toISOString() : null
      const values = { kind: label, name: `${label} Wedding`, status: ceremony.status, starts_at: startsAt, location_name: ceremony.location || null, guest_capacity: ceremony.capacity, updated_by: userId }
      const result = ceremony.databaseId
        ? await supabase!.from('ceremonies').update(values).eq('workspace_id', workspace.id).eq('id', ceremony.databaseId).select('id').single()
        : await supabase!.from('ceremonies').insert({ workspace_id: workspace.id, ...values, created_by: userId }).select('id').single()
      const { data, error } = result
      if (error) throw error
      const ceremonyId = data.id
      const { data: existing, error: existingError } = await supabase!.from('ceremony_segments').select('id').eq('ceremony_id', ceremonyId).is('deleted_at', null)
      if (existingError) throw existingError
      const currentIds = new Set(ceremony.segments.map((segment) => segment.id))
      const removedIds = existing.filter((segment) => !currentIds.has(segment.id)).map((segment) => segment.id)
      if (removedIds.length) {
        const { error: removeError } = await supabase!.from('ceremony_segments').update({ deleted_at: new Date().toISOString(), updated_by: userId }).in('id', removedIds)
        if (removeError) throw removeError
      }
      if (ceremony.segments.length) {
        const { error: segmentError } = await supabase!.from('ceremony_segments').upsert(ceremony.segments.map((segment, position) => ({ id: segment.id, ceremony_id: ceremonyId, name: segment.title || `Segment ${position + 1}`, position, starts_at: ceremony.date && segment.time ? new Date(`${ceremony.date}T${segment.time}:00+01:00`).toISOString() : null, created_by: userId, updated_by: userId, deleted_at: null })))
        if (segmentError) throw segmentError
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ceremonies', workspace.id] })
      void queryClient.invalidateQueries({ queryKey: ['ceremony-options', workspace.id] })
      void queryClient.invalidateQueries({ queryKey: ['seating-ceremonies', workspace.id] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard', workspace.id] })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: async (ceremony: Ceremony) => {
      if (isPreview || !ceremony.databaseId) return
      const { error } = await supabase!.from('ceremonies').update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq('workspace_id', workspace.id).eq('id', ceremony.databaseId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', workspace.id] })
      void queryClient.invalidateQueries({ queryKey: ['ceremony-options', workspace.id] })
      void queryClient.invalidateQueries({ queryKey: ['seating-ceremonies', workspace.id] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard', workspace.id] })
    },
  })

  useEffect(() => {
    if (!ceremonyQuery.data) return
    // Remote records initialize the editable local draft after the query resolves.
    // oxlint-disable-next-line react/set-state-in-effect
    setCeremonies(ceremonyQuery.data.map((row) => {
      const segmentRows = (Array.isArray(row.ceremony_segments) ? row.ceremony_segments : []).filter((segment) => !segment.deleted_at)
      return { id: row.id, databaseId: row.id, kind: row.kind, name: row.name.replace(/ Wedding$/i, ''), status: row.status as CeremonyStatus, date: lagosParts(row.starts_at).date, location: row.location_name ?? '', capacity: row.guest_capacity, segments: segmentRows.sort((a, b) => a.position - b.position).map((segment) => ({ id: segment.id, title: segment.name, time: lagosParts(segment.starts_at).time })) }
    }))
  }, [ceremonyQuery.data])

  function startCreate() {
    setDraft({ id: crypto.randomUUID(), kind: '', name: '', status: 'tentative', date: '', location: '', capacity: null, segments: [] })
    setDraftIsNew(true)
  }

  useCreateParam(startCreate)

  function startEdit(ceremony: Ceremony) {
    setDraft({ ...ceremony, segments: ceremony.segments.map((segment) => ({ ...segment })) })
    setDraftIsNew(false)
  }

  function commitDraft(ceremony: Ceremony) {
    setCeremonies((current) => draftIsNew ? [...current, ceremony] : current.map((item) => item.id === ceremony.id ? ceremony : item))
    if (!isPreview) saveMutation.mutate(ceremony)
    setDraft(null)
  }

  function removeCeremony(ceremony: Ceremony) {
    setCeremonies((current) => current.filter((item) => item.id !== ceremony.id))
    if (!isPreview) deleteMutation.mutate(ceremony)
    setPendingCeremonyDelete(null)
  }

  const confirmedCount = ceremonies.filter(({ status }) => status === 'confirmed').length

  return (
    <div className="page planning-page ceremonies-page ui-page">
      <header className="page-header">
        <div>
          <h1>Ceremonies</h1>
          <p className="page-lead">Keep the essentials for each celebration together.</p>
        </div>
        <div className="header-actions">
          <span className="ceremony-summary">{confirmedCount} of {ceremonies.length} dates confirmed</span>
          <button className="button primary" type="button" onClick={startCreate}><Plus size={16} /> Add ceremony</button>
        </div>
      </header>

      {(saveMutation.error || deleteMutation.error) && (
        <p className="data-error" role="alert">{saveMutation.error?.message ?? deleteMutation.error?.message}</p>
      )}

      {ceremonies.length === 0 ? (
        <div className="ceremony-empty">
          <h2>No ceremonies yet</h2>
          <p>Add the first celebration to start planning dates, venues and the order of events.</p>
          <button className="button primary" type="button" onClick={startCreate}><Plus size={16} /> Add ceremony</button>
        </div>
      ) : (
        <div className="ceremony-list">
          {ceremonies.map((ceremony) => (
            <article className="ceremony-row" key={ceremony.id}>
              <div className="ceremony-row-title">
                <h2>{ceremony.name || 'Untitled ceremony'}</h2>
                <span className={`ceremony-status ${pillTone(ceremony.status)}`}>{statusOptions.find((option) => option.value === ceremony.status)?.label}</span>
              </div>
              <dl className="ceremony-facts">
                <div><dt><CalendarDays size={14} /> Date</dt><dd>{formatCeremonyDate(ceremony.date)}</dd></div>
                <div><dt><MapPin size={14} /> Location</dt><dd>{ceremony.location || 'Not set'}</dd></div>
                <div><dt><Users size={14} /> Capacity</dt><dd>{ceremony.capacity ?? 'Not set'}</dd></div>
                <div><dt><Clock3 size={14} /> Segments</dt><dd>{ceremony.segments.length || 'None'}</dd></div>
              </dl>
              <div className="ceremony-row-actions">
                <button className="button secondary" type="button" onClick={() => startEdit(ceremony)}><Pencil size={15} /> Edit</button>
                <button className="plain-icon-button" type="button" aria-label={`Delete ${ceremony.name || 'ceremony'}`} onClick={() => setPendingCeremonyDelete(ceremony)}><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      {draft && (
        <CeremonyModal
          key={draft.id}
          ceremony={draft}
          isNew={draftIsNew}
          saving={saveMutation.isPending}
          onClose={() => setDraft(null)}
          onSave={commitDraft}
        />
      )}
      {pendingCeremonyDelete && <ConfirmDialog title={`Delete ${pendingCeremonyDelete.name || 'this ceremony'}?`} description="This ceremony will move to the recycle bin and disappear from ceremony options." pending={deleteMutation.isPending} onCancel={() => setPendingCeremonyDelete(null)} onConfirm={() => removeCeremony(pendingCeremonyDelete)} />}
    </div>
  )
}

function formatCeremonyDate(value: string) {
  if (!value) return 'Not set'
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day))
}

/**
 * Add and edit share this form, but they are separate actions: adding opens an
 * empty one, editing opens a copy of that ceremony. Nothing reaches the list
 * until Save, so cancelling genuinely discards.
 */
function CeremonyModal({ ceremony, isNew, saving, onClose, onSave }: { ceremony: Ceremony; isNew: boolean; saving: boolean; onClose: () => void; onSave: (ceremony: Ceremony) => void }) {
  const [values, setValues] = useState<Ceremony>(ceremony)
  const formId = useId()
  const patch = (next: Partial<Ceremony>) => setValues((current) => ({ ...current, ...next }))

  function patchSegment(id: string, next: Partial<CeremonySegment>) {
    setValues((current) => ({ ...current, segments: current.segments.map((segment) => segment.id === id ? { ...segment, ...next } : segment) }))
  }

  return (
    <Modal
      open
      size="wide"
      title={isNew ? 'Add ceremony' : `Edit ${ceremony.name || 'ceremony'}`}
      description="Name and date can be changed at any time."
      onClose={onClose}
      footer={<>
        <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit" form={formId} disabled={saving || !values.name.trim()}>{saving ? 'Saving...' : isNew ? 'Add ceremony' : 'Save changes'}</button>
      </>}
    >
      <form id={formId} className="ceremony-form" onSubmit={(event) => { event.preventDefault(); onSave({ ...values, name: values.name.trim() }) }}>
        <div className="ceremony-form-grid">
          <label className="field-wide"><span>Ceremony name</span>
            <input required maxLength={80} value={values.name} placeholder="Court, Traditional, White..." onChange={(event) => patch({ name: event.target.value })} />
          </label>
          <label><span>Status</span>
            <select value={values.status} onChange={(event) => patch({ status: event.target.value as CeremonyStatus })}>
              {statusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label><span>Date</span>
            <input type="date" value={values.date} onChange={(event) => patch({ date: event.target.value })} />
          </label>
          <label className="field-wide"><span>Location</span>
            <input type="text" value={values.location} placeholder="Add a venue or address" onChange={(event) => patch({ location: event.target.value })} />
          </label>
          <label><span>Capacity</span>
            <input type="number" min="0" inputMode="numeric" value={values.capacity ?? ''} placeholder="Not set" onChange={(event) => patch({ capacity: event.target.value === '' ? null : Number(event.target.value) })} />
          </label>
        </div>

        <section className="ceremony-segments" aria-labelledby={`${formId}-segments`}>
          <div className="ceremony-segments-head">
            <h3 id={`${formId}-segments`}>Order of events</h3>
            <button className="button secondary compact" type="button" onClick={() => setValues((current) => ({ ...current, segments: [...current.segments, { id: crypto.randomUUID(), title: '', time: '' }] }))}>
              <Plus size={14} /> Add segment
            </button>
          </div>
          {values.segments.length === 0 ? (
            <p className="ceremony-segments-empty">No segments yet. Add the parts of the day you want to plan around.</p>
          ) : (
            <div className="ceremony-segment-list">
              {values.segments.map((segment, index) => (
                <div className="ceremony-segment-row" key={segment.id}>
                  <input aria-label={`Segment ${index + 1} name`} value={segment.title} placeholder="Segment name" onChange={(event) => patchSegment(segment.id, { title: event.target.value })} />
                  <input aria-label={`Segment ${index + 1} time`} type="time" value={segment.time} onChange={(event) => patchSegment(segment.id, { time: event.target.value })} />
                  <button className="plain-icon-button" type="button" aria-label={`Remove segment ${index + 1}`} onClick={() => setValues((current) => ({ ...current, segments: current.segments.filter((item) => item.id !== segment.id) }))}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </form>
    </Modal>
  )
}

function lagosParts(value?: string | null) {
  if (!value) return { date: '', time: '' }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}
