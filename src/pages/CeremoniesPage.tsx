import { CalendarDays, MapPin, Plus, Trash2, Users } from '../components/KoboyoIcon'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import './planning.css'

export type CeremonyKind = 'court' | 'traditional' | 'white'
export type CeremonyStatus = 'tentative' | 'confirmed' | 'completed' | 'cancelled'

export interface CeremonySegment {
  id: string
  title: string
  time: string
}

export interface Ceremony {
  id: CeremonyKind
  databaseId?: string
  name: string
  status: CeremonyStatus
  date: string
  location: string
  capacity: number | null
  segments: CeremonySegment[]
}

const initialCeremonies: Ceremony[] = [
  { id: 'court', name: 'Court', status: 'tentative', date: '', location: '', capacity: null, segments: [] },
  { id: 'traditional', name: 'Traditional', status: 'tentative', date: '', location: '', capacity: null, segments: [] },
  { id: 'white', name: 'White', status: 'tentative', date: '', location: '', capacity: null, segments: [] },
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
  const ceremonyQuery = useQuery({
    queryKey: ['ceremonies', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const { data, error } = await supabase!.from('ceremonies').select('id,kind,name,status,starts_at,location_name,guest_capacity,ceremony_segments(id,name,starts_at,position,deleted_at)').eq('workspace_id', workspace.id).is('deleted_at', null)
      if (error) throw error
      return data
    },
  })
  const saveMutation = useMutation({
    mutationFn: async (ceremony: Ceremony) => {
      if (isPreview || !ceremony.databaseId) return
      const startsAt = ceremony.date ? new Date(`${ceremony.date}T12:00:00+01:00`).toISOString() : null
      const { error } = await supabase!.from('ceremonies').update({ name: `${ceremony.name} Wedding`, status: ceremony.status, starts_at: startsAt, location_name: ceremony.location || null, guest_capacity: ceremony.capacity, updated_by: userId }).eq('id', ceremony.databaseId)
      if (error) throw error
      const { data: existing, error: existingError } = await supabase!.from('ceremony_segments').select('id').eq('ceremony_id', ceremony.databaseId).is('deleted_at', null)
      if (existingError) throw existingError
      const currentIds = new Set(ceremony.segments.map((segment) => segment.id))
      const removedIds = existing.filter((segment) => !currentIds.has(segment.id)).map((segment) => segment.id)
      if (removedIds.length) {
        const { error: removeError } = await supabase!.from('ceremony_segments').update({ deleted_at: new Date().toISOString(), updated_by: userId }).in('id', removedIds)
        if (removeError) throw removeError
      }
      if (ceremony.segments.length) {
        const { error: segmentError } = await supabase!.from('ceremony_segments').upsert(ceremony.segments.map((segment, position) => ({ id: segment.id, ceremony_id: ceremony.databaseId, name: segment.title || `Segment ${position + 1}`, position, starts_at: ceremony.date && segment.time ? new Date(`${ceremony.date}T${segment.time}:00+01:00`).toISOString() : null, created_by: userId, updated_by: userId, deleted_at: null })))
        if (segmentError) throw segmentError
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ceremonies', workspace.id] }),
  })

  useEffect(() => {
    if (!ceremonyQuery.data) return
    // Remote records initialize the editable local draft after the query resolves.
    // oxlint-disable-next-line react/set-state-in-effect
    setCeremonies(initialCeremonies.map((fallback) => {
      const row = ceremonyQuery.data.find((item) => item.kind === fallback.id)
      if (!row) return fallback
      const segmentRows = (Array.isArray(row.ceremony_segments) ? row.ceremony_segments : []).filter((segment) => !segment.deleted_at)
      return { ...fallback, databaseId: row.id, name: row.name.replace(/ Wedding$/i, ''), status: row.status as CeremonyStatus, date: lagosParts(row.starts_at).date, location: row.location_name ?? '', capacity: row.guest_capacity, segments: segmentRows.sort((a, b) => a.position - b.position).map((segment) => ({ id: segment.id, title: segment.name, time: lagosParts(segment.starts_at).time })) }
    }))
  }, [ceremonyQuery.data])

  function updateCeremony(id: CeremonyKind, patch: Partial<Ceremony>) {
    setCeremonies((current) => current.map((ceremony) =>
      ceremony.id === id ? { ...ceremony, ...patch } : ceremony,
    ))
  }

  function addSegment(ceremonyId: CeremonyKind) {
    setCeremonies((current) => current.map((ceremony) => ceremony.id === ceremonyId
      ? {
          ...ceremony,
          segments: [...ceremony.segments, { id: crypto.randomUUID(), title: '', time: '' }],
        }
      : ceremony))
  }

  function updateSegment(ceremonyId: CeremonyKind, segmentId: string, patch: Partial<CeremonySegment>) {
    setCeremonies((current) => current.map((ceremony) => ceremony.id === ceremonyId
      ? {
          ...ceremony,
          segments: ceremony.segments.map((segment) =>
            segment.id === segmentId ? { ...segment, ...patch } : segment,
          ),
        }
      : ceremony))
  }

  function removeSegment(ceremonyId: CeremonyKind, segmentId: string) {
    setCeremonies((current) => current.map((ceremony) => ceremony.id === ceremonyId
      ? { ...ceremony, segments: ceremony.segments.filter((segment) => segment.id !== segmentId) }
      : ceremony))
  }

  return (
    <div className="page planning-page ceremonies-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Celebration plan / 03 ceremonies</p>
          <h1>Ceremonies</h1>
          <p className="page-lead">Keep the essentials for each celebration together. Save each ceremony after making changes.</p>
        </div>
        <div className="ceremony-summary" aria-label="Ceremony status summary">
          <strong>{ceremonies.filter(({ status }) => status === 'confirmed').length}</strong>
          <span>dates confirmed</span>
        </div>
      </header>

      <div className="ceremony-editor-list">
        {ceremonies.map((ceremony, index) => (
          <article className="ceremony-editor" key={ceremony.id}>
            <div className="ceremony-editor-heading">
              <span className="ceremony-editor-number">0{index + 1}</span>
              <div>
                <p className="eyebrow">{ceremony.id === 'court' ? 'Legal ceremony' : 'Celebration'}</p>
                <h2>{ceremony.name}</h2>
              </div>
              <label className={`status-select status-${ceremony.status}`}>
                <span className="sr-only">{ceremony.name} status</span>
                <select
                  value={ceremony.status}
                  onChange={(event) => updateCeremony(ceremony.id, { status: event.target.value as CeremonyStatus })}
                >
                  {statusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>

            <div className="ceremony-fields">
              <label className="planning-field">
                <span><CalendarDays size={14} /> Date</span>
                <input
                  type="date"
                  value={ceremony.date}
                  onChange={(event) => updateCeremony(ceremony.id, { date: event.target.value })}
                />
              </label>
              <label className="planning-field field-wide">
                <span><MapPin size={14} /> Location</span>
                <input
                  type="text"
                  value={ceremony.location}
                  placeholder="Add a venue or address"
                  onChange={(event) => updateCeremony(ceremony.id, { location: event.target.value })}
                />
              </label>
              <label className="planning-field">
                <span><Users size={14} /> Capacity</span>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={ceremony.capacity ?? ''}
                  placeholder="Not set"
                  onChange={(event) => updateCeremony(ceremony.id, {
                    capacity: event.target.value === '' ? null : Number(event.target.value),
                  })}
                />
              </label>
            </div>

            {ceremony.id !== 'court' && (
              <section className="segments-section" aria-labelledby={`${ceremony.id}-segments`}>
                <div className="segments-header">
                  <div>
                    <p className="eyebrow">Order of events</p>
                    <h3 id={`${ceremony.id}-segments`}>Segments</h3>
                  </div>
                  <button className="button secondary compact" type="button" onClick={() => addSegment(ceremony.id)}>
                    <Plus size={14} /> Add segment
                  </button>
                </div>
                {ceremony.segments.length === 0 ? (
                  <button className="segment-empty" type="button" onClick={() => addSegment(ceremony.id)}>
                    <Plus size={16} />
                    <span><strong>No segments yet</strong>Add the first part of the {ceremony.name.toLowerCase()} ceremony.</span>
                  </button>
                ) : (
                  <div className="segment-list">
                    {ceremony.segments.map((segment, segmentIndex) => (
                      <div className="segment-row" key={segment.id}>
                        <span className="segment-index">{String(segmentIndex + 1).padStart(2, '0')}</span>
                        <input
                          aria-label={`Segment ${segmentIndex + 1} name`}
                          value={segment.title}
                          placeholder="Segment name"
                          onChange={(event) => updateSegment(ceremony.id, segment.id, { title: event.target.value })}
                        />
                        <input
                          aria-label={`Segment ${segmentIndex + 1} time`}
                          type="time"
                          value={segment.time}
                          onChange={(event) => updateSegment(ceremony.id, segment.id, { time: event.target.value })}
                        />
                        <button className="plain-icon-button" type="button" aria-label="Remove segment" onClick={() => removeSegment(ceremony.id, segment.id)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
            <div className="ceremony-save-row">
              {saveMutation.error && <span>{saveMutation.error.message}</span>}
              <button className="button primary" type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(ceremony)}>{isPreview ? 'Keep preview changes' : saveMutation.isPending ? 'Saving...' : 'Save ceremony'}</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function lagosParts(value?: string | null) {
  if (!value) return { date: '', time: '' }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}
