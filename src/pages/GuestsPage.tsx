import { useDeferredValue, useEffect, useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BedDouble,
  Check,
  FileSpreadsheet,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  Tag,
  Upload,
  UserPlus,
  UserRound,
  Users,
  X,
} from '../components/KoboyoIcon'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { pillTone } from '../lib/pills'
import {
  GUEST_IMPORT_FIELDS,
  buildGuestImportReview,
  normalizeEmail,
  normalizePhone,
  parseGuestData,
  parseGuestWorkbookSheets,
  suggestGuestFieldMapping,
  type GuestFieldMapping,
  type GuestImportField,
  type GuestImportReviewRow,
  type ImportableGuest,
  type ParsedGuestData,
  type RsvpStatus,
} from '../lib/guest-import'
import { supabase } from '../lib/supabase'
import { relationOne, useWorkspace } from '../lib/workspace-context'
import './guests.css'

type Guest = ImportableGuest & { id: string }
type EventName = keyof Guest['rsvps']

const EVENT_LABELS: Record<EventName, string> = {
  court: 'Court',
  traditional: 'Traditional',
  white: 'White',
}

const FIELD_LABELS: Record<GuestImportField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  plusOneName: 'Plus-one name',
  tags: 'Tags',
  accommodation: 'Accommodation',
  courtRsvp: 'Court RSVP',
  traditionalRsvp: 'Traditional RSVP',
  whiteRsvp: 'White RSVP',
}

const emptyGuest: Omit<Guest, 'id'> = {
  firstName: '', lastName: '', email: '', phone: '', plusOneAllowed: false, plusOneName: '', tags: [], accommodation: '',
  rsvps: { court: 'pending', traditional: 'pending', white: 'pending' },
}

export function GuestsPage() {
  const { workspace, userId, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const [guests, setGuests] = useState<Guest[]>([])
  const [query, setQuery] = useState('')
  const [eventFilter, setEventFilter] = useState<'all' | EventName>('all')
  const [rsvpFilter, setRsvpFilter] = useState<'all' | RsvpStatus>('all')
  const [entryOpen, setEntryOpen] = useState(false)
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Guest | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())
  const ceremonyQuery = useQuery({
    queryKey: ['ceremony-options', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const { data, error } = await supabase!.from('ceremonies').select('id,kind').eq('workspace_id', workspace.id).is('deleted_at', null)
      if (error) throw error
      return data
    },
  })
  const guestsQuery = useQuery({
    queryKey: ['guests', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const { data, error } = await supabase!.from('guests').select('id,full_name,email,phone,plus_one_allowed,plus_one_name,guest_accommodations(name,deleted_at),guest_tag_assignments(guest_tags(name)),guest_invitations(rsvp_status,deleted_at,ceremonies(kind))').eq('workspace_id', workspace.id).is('deleted_at', null).order('full_name')
      if (error) throw error
      return data
    },
  })
  const saveMutation = useMutation({
    mutationFn: async ({ records, source }: { records: Omit<Guest, 'id'>[]; source: 'manual' | 'csv' | 'xlsx' | 'clipboard' }) => {
      for (const guest of records) await persistGuest(guest, source)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['guests', workspace.id] })
      setEntryOpen(false)
    },
  })
  const importMutation = useMutation({
    mutationFn: async ({ rows, source }: { rows: GuestImportReviewRow[]; source: 'csv' | 'xlsx' | 'clipboard' }) => {
      const { error } = await supabase!.rpc('import_guest_rows', { target_workspace_id: workspace.id, import_source: source, guest_rows: rows })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guests', workspace.id] }),
  })
  const guestUpdateMutation = useMutation({
    mutationFn: async (operation: { type: 'rsvp'; guestId: string; event: EventName; status: RsvpStatus } | { type: 'delete'; guestId: string }) => {
      if (operation.type === 'delete') {
        const { error } = await supabase!.from('guests').update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq('id', operation.guestId)
        if (error) throw error
        return
      }
      const ceremony = ceremonyQuery.data?.find((item) => item.kind === operation.event)
      if (!ceremony) throw new Error('Ceremony is unavailable')
      const values = { rsvp_status: operation.status === 'attending' ? 'accepted' : operation.status, responded_at: operation.status === 'pending' ? null : new Date().toISOString(), updated_by: userId }
      const { data, error } = await supabase!.from('guest_invitations').update(values).eq('workspace_id', workspace.id).eq('guest_id', operation.guestId).eq('ceremony_id', ceremony.id).is('deleted_at', null).select('id')
      if (error) throw error
      if (!data.length) {
        const { error: insertError } = await supabase!.from('guest_invitations').insert({ ...values, workspace_id: workspace.id, guest_id: operation.guestId, ceremony_id: ceremony.id, invited_plus_one: guests.find((guest) => guest.id === operation.guestId)?.plusOneAllowed ?? false, created_by: userId })
        if (insertError) throw insertError
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guests', workspace.id] }),
    onError: () => queryClient.invalidateQueries({ queryKey: ['guests', workspace.id] }),
  })
  const guestEditMutation = useMutation({
    mutationFn: async (guest: Guest) => persistGuestUpdate(guest),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['guests', workspace.id] })
      setEditingGuest(null)
    },
  })

  // oxlint-disable react/set-state-in-effect
  useEffect(() => {
    if (!guestsQuery.data) return
    // Remote records initialize the directory after each successful fetch or import.
    // oxlint-disable-next-line react(set-state-in-effect)
    setGuests(guestsQuery.data.map((row) => {
      const nameParts = row.full_name.trim().split(/\s+/)
      const invitationRows = Array.isArray(row.guest_invitations) ? row.guest_invitations.filter((invitation) => !invitation.deleted_at) : []
      const rsvps: ImportableGuest['rsvps'] = { court: 'pending', traditional: 'pending', white: 'pending' }
      invitationRows.forEach((invitation) => {
        const kind = relationOne(invitation.ceremonies)?.kind as keyof typeof rsvps | undefined
        if (kind) rsvps[kind] = invitation.rsvp_status === 'accepted' ? 'attending' : invitation.rsvp_status === 'declined' ? 'declined' : 'pending'
      })
      const accommodations = Array.isArray(row.guest_accommodations) ? row.guest_accommodations : []
      return { id: row.id, firstName: nameParts.shift() ?? '', lastName: nameParts.join(' '), email: row.email ?? '', phone: row.phone ?? '', plusOneAllowed: row.plus_one_allowed, plusOneName: row.plus_one_name ?? '', tags: (row.guest_tag_assignments ?? []).map((assignment) => relationOne(assignment.guest_tags)?.name).filter(Boolean) as string[], accommodation: accommodations.find((item) => !item.deleted_at)?.name ?? '', rsvps }
    }))
  }, [guestsQuery.data])
  // oxlint-enable react/set-state-in-effect

  async function persistGuest(guest: Omit<Guest, 'id'>, source: 'manual' | 'csv' | 'xlsx' | 'clipboard') {
    if (!ceremonyQuery.data) throw new Error('Ceremony details are still loading. Please try again.')
    const { data: created, error } = await supabase!.from('guests').insert({ workspace_id: workspace.id, full_name: `${guest.firstName} ${guest.lastName}`.trim(), email: guest.email || null, normalized_email: guest.email || null, phone: guest.phone || null, normalized_phone: guest.phone || null, plus_one_allowed: guest.plusOneAllowed, plus_one_name: guest.plusOneName || null, source_type: source, created_by: userId, updated_by: userId }).select('id').single()
    if (error) throw error
    try {
      if (guest.accommodation) {
        const { error: accommodationError } = await supabase!.from('guest_accommodations').insert({ workspace_id: workspace.id, guest_id: created.id, name: guest.accommodation, created_by: userId, updated_by: userId })
        if (accommodationError) throw accommodationError
      }
      for (const ceremony of ceremonyQuery.data ?? []) {
        const status = guest.rsvps[ceremony.kind as keyof typeof guest.rsvps]
        const { error: invitationError } = await supabase!.from('guest_invitations').insert({ workspace_id: workspace.id, guest_id: created.id, ceremony_id: ceremony.id, rsvp_status: status === 'attending' ? 'accepted' : status, invited_plus_one: guest.plusOneAllowed, responded_at: status === 'pending' ? null : new Date().toISOString(), created_by: userId, updated_by: userId })
        if (invitationError) throw invitationError
      }
      for (const tagName of guest.tags) {
        const tagId = await getOrCreateTag(tagName)
        const { error: assignmentError } = await supabase!.from('guest_tag_assignments').insert({ workspace_id: workspace.id, guest_id: created.id, tag_id: tagId, created_by: userId })
        if (assignmentError) throw assignmentError
      }
    } catch (relatedError) {
      await supabase!.from('guests').update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq('id', created.id)
      throw relatedError
    }
  }

  async function getOrCreateTag(tagName: string) {
    const lookup = await supabase!.from('guest_tags').select('id').eq('workspace_id', workspace.id).ilike('name', tagName).is('deleted_at', null).maybeSingle()
    if (lookup.error) throw lookup.error
    if (lookup.data) return lookup.data.id
    const created = await supabase!.from('guest_tags').insert({ workspace_id: workspace.id, name: tagName, created_by: userId, updated_by: userId }).select('id').single()
    if (!created.error) return created.data.id
    if (created.error.code !== '23505') throw created.error
    const raced = await supabase!.from('guest_tags').select('id').eq('workspace_id', workspace.id).ilike('name', tagName).is('deleted_at', null).single()
    if (raced.error) throw raced.error
    return raced.data.id
  }

  async function persistGuestUpdate(guest: Guest) {
    if (!ceremonyQuery.data) throw new Error('Ceremony details are still loading. Please try again.')
    const cleanEmail = normalizeEmail(guest.email)
    const cleanPhone = normalizePhone(guest.phone)
    const cleanTags = [...new Map(guest.tags.map((tag) => tag.trim()).filter(Boolean).map((tag) => [tag.toLocaleLowerCase(), tag])).values()]
    const { error } = await supabase!.from('guests').update({ full_name: `${guest.firstName} ${guest.lastName}`.trim(), email: cleanEmail || null, normalized_email: cleanEmail || null, phone: cleanPhone || null, normalized_phone: cleanPhone || null, plus_one_allowed: guest.plusOneAllowed, plus_one_name: guest.plusOneAllowed && guest.plusOneName.trim() ? guest.plusOneName.trim() : null, updated_by: userId }).eq('id', guest.id).eq('workspace_id', workspace.id)
    if (error) throw error
    const resolvedTags = await Promise.all(cleanTags.map(async (name) => ({ id: await getOrCreateTag(name), name })))

    const accommodations = await supabase!.from('guest_accommodations').select('id').eq('workspace_id', workspace.id).eq('guest_id', guest.id).is('deleted_at', null)
    if (accommodations.error) throw accommodations.error
    const accommodation = guest.accommodation.trim()
    if (accommodation && accommodations.data[0]) {
      const { error: accommodationError } = await supabase!.from('guest_accommodations').update({ name: accommodation, updated_by: userId }).eq('id', accommodations.data[0].id)
      if (accommodationError) throw accommodationError
    } else if (accommodation) {
      const { error: accommodationError } = await supabase!.from('guest_accommodations').insert({ workspace_id: workspace.id, guest_id: guest.id, name: accommodation, created_by: userId, updated_by: userId })
      if (accommodationError) throw accommodationError
    }
    const obsoleteAccommodationIds = accommodations.data.slice(accommodation ? 1 : 0).map((item) => item.id)
    if (obsoleteAccommodationIds.length) {
      const { error: cleanupError } = await supabase!.from('guest_accommodations').update({ deleted_at: new Date().toISOString(), updated_by: userId }).in('id', obsoleteAccommodationIds)
      if (cleanupError) throw cleanupError
    }

    const invitations = await supabase!.from('guest_invitations').select('id,ceremony_id').eq('workspace_id', workspace.id).eq('guest_id', guest.id).is('deleted_at', null)
    if (invitations.error) throw invitations.error
    for (const ceremony of ceremonyQuery.data ?? []) {
      const status = guest.rsvps[ceremony.kind as EventName] ?? 'pending'
      const values = { rsvp_status: status === 'attending' ? 'accepted' : status, invited_plus_one: guest.plusOneAllowed, responded_at: status === 'pending' ? null : new Date().toISOString(), updated_by: userId }
      const invitation = invitations.data.find((item) => item.ceremony_id === ceremony.id)
      const result = invitation
        ? await supabase!.from('guest_invitations').update(values).eq('id', invitation.id)
        : await supabase!.from('guest_invitations').insert({ ...values, workspace_id: workspace.id, guest_id: guest.id, ceremony_id: ceremony.id, created_by: userId })
      if (result.error) throw result.error
    }

    const assignments = await supabase!.from('guest_tag_assignments').select('tag_id').eq('workspace_id', workspace.id).eq('guest_id', guest.id)
    if (assignments.error) throw assignments.error
    const desiredTagIds = new Set(resolvedTags.map((tag) => tag.id))
    const existingTagIds = new Set(assignments.data.map((assignment) => assignment.tag_id))
    const additions = resolvedTags.filter((tag) => !existingTagIds.has(tag.id)).map((tag) => ({ workspace_id: workspace.id, guest_id: guest.id, tag_id: tag.id, created_by: userId }))
    if (additions.length) {
      const { error: assignmentError } = await supabase!.from('guest_tag_assignments').insert(additions)
      if (assignmentError) throw assignmentError
    }
    const removals = assignments.data.filter((assignment) => !desiredTagIds.has(assignment.tag_id)).map((assignment) => assignment.tag_id)
    if (removals.length) {
      const { error: removalError } = await supabase!.from('guest_tag_assignments').delete().eq('guest_id', guest.id).in('tag_id', removals)
      if (removalError) throw removalError
    }
  }

  const filteredGuests = guests.filter((guest) => {
    const haystack = [guest.firstName, guest.lastName, guest.email, guest.phone, guest.accommodation, ...guest.tags]
      .join(' ').toLocaleLowerCase()
    const matchesQuery = !deferredQuery || haystack.includes(deferredQuery)
    const statuses = eventFilter === 'all' ? Object.values(guest.rsvps) : [guest.rsvps[eventFilter]]
    return matchesQuery && (rsvpFilter === 'all' || statuses.includes(rsvpFilter))
  })

  const attending = guests.filter((guest) => Object.values(guest.rsvps).includes('attending')).length
  const pending = guests.filter((guest) => Object.values(guest.rsvps).includes('pending')).length

  function addGuest(guest: Omit<Guest, 'id'>) {
    if (isPreview) {
      setGuests((current) => [...current, { ...guest, id: crypto.randomUUID() }])
      setEntryOpen(false)
    }
    else saveMutation.mutate({ records: [guest], source: 'manual' })
  }

  function editGuest(guest: Omit<Guest, 'id'>) {
    if (!editingGuest) return
    const updated = { ...guest, id: editingGuest.id }
    if (isPreview) {
      setGuests((current) => current.map((item) => item.id === updated.id ? updated : item))
      setEditingGuest(null)
    } else guestEditMutation.mutate(updated)
  }

  function addImportedGuests(rows: GuestImportReviewRow[], source: 'csv' | 'xlsx' | 'clipboard') {
    const imported = rows
      .filter((row) => row.status === 'ready')
      .map((row) => ({ ...row.guest, id: crypto.randomUUID() }))
    if (isPreview) setGuests((current) => [...current, ...imported])
    else importMutation.mutate({ rows, source })
    setImportOpen(false)
  }

  function updateRsvp(guestId: string, event: EventName, status: RsvpStatus) {
    setGuests((current) => current.map((guest) => guest.id === guestId ? { ...guest, rsvps: { ...guest.rsvps, [event]: status } } : guest))
    if (!isPreview) guestUpdateMutation.mutate({ type: 'rsvp', guestId, event, status })
  }

  function removeGuest(guestId: string) {
    setGuests((current) => current.filter((guest) => guest.id !== guestId))
    if (!isPreview) guestUpdateMutation.mutate({ type: 'delete', guestId })
  }

  function confirmDelete() {
    if (!pendingDelete) return
    removeGuest(pendingDelete.id)
    setPendingDelete(null)
  }

  return (
    <div className="page guests-page">
      <header className="page-header guests-header">
        <div>
          <p className="eyebrow">People & invitations</p>
          <h1>Guest book</h1>
          <p className="page-lead">Keep every guest, invitation, stay, and ceremony response in one considered list.</p>
        </div>
        <div className="header-actions">
          <button className="button secondary" type="button" onClick={() => setImportOpen(true)}><Upload size={16} /> Import list</button>
          <button className="button primary" type="button" onClick={() => { setEditingGuest(null); setEntryOpen((open) => !open) }}><Plus size={16} /> Add guest</button>
        </div>
      </header>

      <section className="guest-summary" aria-label="Guest summary">
        <Summary value={guests.length} label="Total guests" detail="Individual records" />
        <Summary value={attending} label="Attending" detail="At least one event" />
        <Summary value={pending} label="Awaiting reply" detail="At least one event" />
        <Summary value={guests.filter((guest) => guest.accommodation).length} label="Stays noted" detail="Accommodation tracked" />
      </section>

      {entryOpen && <GuestEntry onSave={addGuest} onClose={() => setEntryOpen(false)} isSaving={saveMutation.isPending} />}
      {editingGuest && <GuestEntry initialGuest={editingGuest} onSave={editGuest} onClose={() => setEditingGuest(null)} isSaving={guestEditMutation.isPending} />}
      {(guestsQuery.error || saveMutation.error || importMutation.error || guestUpdateMutation.error || guestEditMutation.error) && <p className="guest-data-error">{guestsQuery.error?.message ?? saveMutation.error?.message ?? importMutation.error?.message ?? guestUpdateMutation.error?.message ?? guestEditMutation.error?.message}</p>}

      <section className="guest-directory">
        <div className="guest-tools">
          <label className="guest-search">
            <Search size={15} />
            <span className="sr-only">Search guests</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, contact, tag, or hotel" />
          </label>
          <div className="guest-filters">
            <SelectFilter label="Event" value={eventFilter} onChange={(value) => setEventFilter(value as typeof eventFilter)}>
              <option value="all">All events</option>
              {Object.entries(EVENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SelectFilter>
            <SelectFilter label="Response" value={rsvpFilter} onChange={(value) => setRsvpFilter(value as typeof rsvpFilter)}>
              <option value="all">All responses</option>
              <option value="attending">Attending</option>
              <option value="pending">Pending</option>
              <option value="declined">Declined</option>
            </SelectFilter>
          </div>
        </div>

        <div className="directory-heading">
          <span>{filteredGuests.length} {filteredGuests.length === 1 ? 'guest' : 'guests'}</span>
          <span>Manual and imported records</span>
        </div>

        {filteredGuests.length ? (
          <div className="guest-list">
            {filteredGuests.map((guest) => <GuestRow key={guest.id} guest={guest} onRsvp={updateRsvp} onEdit={setEditingGuest} onRemove={(id) => setPendingDelete(guests.find((item) => item.id === id) ?? null)} />)}
          </div>
        ) : (
          <div className="guest-empty"><Users size={22} /><h2>No guests found</h2><p>Try clearing a filter or add someone new.</p></div>
        )}
      </section>

      {importOpen && <GuestImport guests={guests} onClose={() => setImportOpen(false)} onImport={addImportedGuests} />}
      {pendingDelete && <ConfirmDialog title={`Remove ${pendingDelete.firstName} ${pendingDelete.lastName}?`} description="This guest and their planning links will move to the recycle bin and can be restored later." onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />}
    </div>
  )
}

function Summary({ value, label, detail }: { value: number; label: string; detail: string }) {
  return <div className="guest-summary-item"><strong>{value}</strong><div><span>{label}</span><small>{detail}</small></div></div>
}

function SelectFilter({ label, value, onChange, children }: {
  label: string; value: string; onChange: (value: string) => void; children: React.ReactNode
}) {
  return (
    <label className="compact-select"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>
  )
}

function GuestRow({ guest, onRsvp, onEdit, onRemove }: { guest: Guest; onRsvp: (guestId: string, event: EventName, status: RsvpStatus) => void; onEdit: (guest: Guest) => void; onRemove: (guestId: string) => void }) {
  return (
    <article className="guest-row">
      <div className="guest-identity"><span className="guest-avatar"><UserRound size={25} /></span><div><h2>{guest.firstName} {guest.lastName}</h2><div className="guest-contact">{guest.email && <span><Mail size={12} />{guest.email}</span>}{guest.phone && <span><Phone size={12} />{guest.phone}</span>}</div></div></div>
      <div className="guest-notes">
        <div className="tag-list">{guest.tags.map((tag) => <span className={`guest-tag ${pillTone(tag)}`} key={tag}><Tag size={10} />{tag}</span>)}</div>
        {guest.accommodation && <span className="guest-stay"><BedDouble size={13} />{guest.accommodation}</span>}
      </div>
      <div className="rsvp-list">
        {(Object.keys(EVENT_LABELS) as EventName[]).map((event) => <RsvpBadge key={event} event={event} status={guest.rsvps[event]} onChange={(status) => onRsvp(guest.id, event, status)} />)}
      </div>
      <div className="guest-row-actions"><button className="guest-edit" type="button" aria-label={`Edit ${guest.firstName} ${guest.lastName}`} onClick={() => onEdit(guest)}><Pencil size={14} /></button><button className="guest-remove" type="button" aria-label={`Remove ${guest.firstName} ${guest.lastName}`} onClick={() => onRemove(guest.id)}><X size={14} /></button></div>
    </article>
  )
}

function RsvpBadge({ event, status, onChange }: { event: EventName; status: RsvpStatus; onChange: (status: RsvpStatus) => void }) {
  return <label className={`rsvp-badge ${status}`}><i />{EVENT_LABELS[event]}<select className={pillTone(status)} aria-label={`${EVENT_LABELS[event]} RSVP`} value={status} onChange={(event) => onChange(event.target.value as RsvpStatus)}><option value="pending">Pending</option><option value="attending">Attending</option><option value="declined">Declined</option></select></label>
}

function GuestEntry({ initialGuest, onSave, onClose, isSaving }: { initialGuest?: Guest; onSave: (guest: Omit<Guest, 'id'>) => void; onClose: () => void; isSaving: boolean }) {
  const [guest, setGuest] = useState<Omit<Guest, 'id'>>(initialGuest ? { firstName: initialGuest.firstName, lastName: initialGuest.lastName, email: initialGuest.email, phone: initialGuest.phone, plusOneAllowed: initialGuest.plusOneAllowed, plusOneName: initialGuest.plusOneName, tags: [...initialGuest.tags], accommodation: initialGuest.accommodation, rsvps: { ...initialGuest.rsvps } } : emptyGuest)
  const [tags, setTags] = useState(initialGuest?.tags.join(', ') ?? '')
  const canSubmit = Boolean((guest.firstName || guest.lastName) && (guest.email || guest.phone))
  const setField = (field: keyof Omit<Guest, 'id' | 'rsvps' | 'tags'>, value: string) => setGuest((current) => ({ ...current, [field]: value }))

  return (
    <section className="guest-entry" aria-labelledby="guest-entry-title">
      <div className="entry-intro"><p className="eyebrow">{initialGuest ? 'Update record' : 'New record'}</p><h2 id="guest-entry-title">{initialGuest ? 'Edit guest' : 'Add a guest'}</h2><p>Name and one contact method are required.</p></div>
      <div className="entry-fields">
        <label><span>First name</span><input value={guest.firstName} onChange={(event) => setField('firstName', event.target.value)} /></label>
        <label><span>Last name</span><input value={guest.lastName} onChange={(event) => setField('lastName', event.target.value)} /></label>
        <label><span>Email</span><input type="email" value={guest.email} onChange={(event) => setField('email', event.target.value)} /></label>
        <label><span>Phone</span><input type="tel" value={guest.phone} onChange={(event) => setField('phone', event.target.value)} /></label>
        <label className="plus-one-toggle"><span>Plus-one allowed</span><input type="checkbox" checked={guest.plusOneAllowed} onChange={(event) => setGuest((current) => ({ ...current, plusOneAllowed: event.target.checked, plusOneName: event.target.checked ? current.plusOneName : '' }))} /></label>
        <label><span>Plus-one name</span><input disabled={!guest.plusOneAllowed} value={guest.plusOneName} onChange={(event) => setField('plusOneName', event.target.value)} /></label>
        <label><span>Tags <small>comma separated</small></span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Family, Lagos" /></label>
        <label><span>Accommodation</span><input value={guest.accommodation} onChange={(event) => setField('accommodation', event.target.value)} placeholder="Hotel or arrangement" /></label>
      </div>
      <div className="entry-rsvps">
        {(Object.keys(EVENT_LABELS) as EventName[]).map((event) => (
          <label key={event}><span>{EVENT_LABELS[event]} RSVP</span><select className={pillTone(guest.rsvps[event])} value={guest.rsvps[event]} onChange={(change) => setGuest((current) => ({ ...current, rsvps: { ...current.rsvps, [event]: change.target.value as RsvpStatus } }))}><option value="pending">Pending</option><option value="attending">Attending</option><option value="declined">Declined</option></select></label>
        ))}
      </div>
      <div className="entry-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="button" disabled={!canSubmit || isSaving} onClick={() => onSave({ ...guest, email: normalizeEmail(guest.email), phone: normalizePhone(guest.phone), tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) })}>{initialGuest ? <Pencil size={15} /> : <UserPlus size={15} />} {isSaving ? 'Saving...' : initialGuest ? 'Save changes' : 'Add to list'}</button></div>
    </section>
  )
}

function GuestImport({ guests, onClose, onImport }: { guests: Guest[]; onClose: () => void; onImport: (rows: GuestImportReviewRow[], source: 'csv' | 'xlsx' | 'clipboard') => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [pasted, setPasted] = useState('')
  const [parsed, setParsed] = useState<ParsedGuestData>({ headers: [], rows: [] })
  const [mapping, setMapping] = useState<GuestFieldMapping>({})
  const [source, setSource] = useState<'csv' | 'xlsx' | 'clipboard'>('csv')
  const [workbookSheets, setWorkbookSheets] = useState<Array<{ name: string; data: ParsedGuestData }>>([])
  const inputId = useId()

  const review = step === 3 ? buildGuestImportReview(parsed.rows, mapping, guests) : []
  const readyCount = review.filter((row) => row.status === 'ready').length
  const duplicateCount = review.filter((row) => row.status === 'duplicate').length

  function stageData(data: ParsedGuestData, nextSource: 'csv' | 'xlsx' | 'clipboard') {
    if (!data.headers.length || !data.rows.length) return
    setParsed(data)
    setMapping(suggestGuestFieldMapping(data.headers))
    setSource(nextSource)
    setStep(2)
  }

  async function readFile(file: File | undefined) {
    if (!file) return
    const isWorkbook = file.name.toLocaleLowerCase().endsWith('.xlsx')
    if (isWorkbook) {
      const sheets = await parseGuestWorkbookSheets(file)
      if (sheets.length === 1) stageData(sheets[0].data, 'xlsx')
      else setWorkbookSheets(sheets)
    } else stageData(parseGuestData(await file.text()), 'csv')
  }

  return (
    <div className="import-layer" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <button className="import-backdrop" type="button" onClick={onClose} aria-label="Close import" />
      <section className="import-panel">
        <header className="import-header"><div><p className="eyebrow">Guest list utility</p><h2 id="import-title">Import guests</h2></div><button className="import-close" type="button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
        <div className="import-steps">{['Add rows', 'Map fields', 'Review'].map((label, index) => <span className={step >= index + 1 ? 'active' : ''} key={label}><b>{index + 1}</b>{label}</span>)}</div>

        <div className="import-body">
          {step === 1 && (
            <div className="import-source">
               <label className="file-drop" htmlFor={inputId}><FileSpreadsheet size={24} /><strong>Choose a CSV or XLSX file</strong><span>For multi-sheet workbooks, you will choose which worksheet to import.</span><input id={inputId} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void readFile(event.target.files?.[0])} /></label>
              {workbookSheets.length > 1 && <div className="sheet-picker"><strong>Choose a worksheet</strong>{workbookSheets.map((sheet) => <button type="button" key={sheet.name} disabled={!sheet.data.rows.length} onClick={() => stageData(sheet.data, 'xlsx')}><span>{sheet.name}</span><small>{sheet.data.rows.length} rows</small></button>)}</div>}
              <div className="import-divider"><span>or paste rows</span></div>
              <label className="paste-field"><span>Include a header row. Commas and tab-separated columns are supported.</span><textarea value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={'First name,Last name,Email,Phone,Tags\nAda,Okoye,ada@example.com,+234 800 000 0000,Family'} /></label>
            </div>
          )}

          {step === 2 && (
            <div className="mapping-stage">
              <div className="stage-note"><div><strong>Match your columns</strong><span>{parsed.rows.length} rows found in {parsed.headers.length} columns</span></div><p>Review each suggested match. Unmapped fields stay blank.</p></div>
              <div className="mapping-grid">
                {GUEST_IMPORT_FIELDS.map((field) => (
                  <label key={field}><span>{FIELD_LABELS[field]}{field === 'firstName' || field === 'lastName' ? <small>Name</small> : null}</span><select value={mapping[field] ?? ''} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value || undefined }))}><option value="">Do not import</option>{parsed.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>
                ))}
              </div>
              <div className="mapping-preview"><span>Source preview</span><div>{parsed.headers.map((header) => <code key={header}>{header}: {parsed.rows[0]?.[header] || '—'}</code>)}</div></div>
            </div>
          )}

          {step === 3 && (
            <div className="review-stage">
              <div className="review-summary"><span><Check size={15} /> <b>{readyCount}</b> ready</span><span><Users size={15} /> <b>{duplicateCount}</b> duplicates skipped</span><span><X size={15} /> <b>{review.length - readyCount - duplicateCount}</b> invalid</span></div>
              <p className="review-rule">Email is matched first, then normalized phone. Duplicates remain visible here but will not be imported.</p>
              <div className="review-table">
                {review.map((row) => <div className={`review-row ${row.status}`} key={row.sourceIndex}><span className="review-index">{String(row.sourceIndex).padStart(2, '0')}</span><div><strong>{row.guest.firstName} {row.guest.lastName}</strong><small>{row.guest.email || row.guest.phone || 'No contact information'}</small></div><span className="review-status">{row.status}</span>{row.reason && <p>{row.reason}</p>}</div>)}
              </div>
            </div>
          )}
        </div>

        <footer className="import-footer"><p><b>No automatic sync.</b> Nothing is added until you confirm this review.</p><div>{step > 1 && <button className="button secondary" type="button" onClick={() => setStep((step - 1) as 1 | 2)}>Back</button>}{step === 1 && <button className="button primary" type="button" disabled={!pasted.trim()} onClick={() => stageData(parseGuestData(pasted), 'clipboard')}>Map pasted rows</button>}{step === 2 && <button className="button primary" type="button" onClick={() => setStep(3)}>Review import</button>}{step === 3 && <button className="button primary" type="button" disabled={!readyCount} onClick={() => onImport(review, source)}>Import {readyCount} guests</button>}</div></footer>
      </section>
    </div>
  )
}
