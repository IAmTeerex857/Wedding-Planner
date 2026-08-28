import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Armchair, Lock, Plus, Unlock, Users } from '../components/KoboyoIcon'
import { supabase } from '../lib/supabase'
import { relationOne, useWorkspace } from '../lib/workspace-context'
import './seating.css'

type EventName = 'Traditional' | 'White'
type SeatGuest = { id: string; name: string; tags: string[]; tableId: string | null }
type Table = { id: string; name: string; capacity: number; locked: boolean }
type PersistOperation =
  | { type: 'add-table'; name: string; capacity: number }
  | { type: 'set-lock'; tableId: string; locked: boolean }
  | { type: 'assign'; guestIds: string[]; tableId: string | null }

const emptyTables: Record<EventName, Table[]> = { Traditional: [], White: [] }
const emptyGuests: Record<EventName, SeatGuest[]> = { Traditional: [], White: [] }

export function SeatingPage() {
  const { workspace, userId, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const [event, setEvent] = useState<EventName>('Traditional')
  const [previewTables, setPreviewTables] = useState(emptyTables)
  const [previewGuests, setPreviewGuests] = useState(emptyGuests)
  const [selected, setSelected] = useState<string[]>([])
  const [tableName, setTableName] = useState('')
  const [capacity, setCapacity] = useState('10')
  const [operationError, setOperationError] = useState('')

  const ceremoniesQuery = useQuery({
    queryKey: ['seating-ceremonies', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const { data, error } = await supabase!.from('ceremonies').select('id,kind').eq('workspace_id', workspace.id).in('kind', ['traditional', 'white']).is('deleted_at', null)
      if (error) throw error
      return data
    },
  })
  const ceremony = ceremoniesQuery.data?.find((item) => item.kind === event.toLocaleLowerCase())
  const seatingQuery = useQuery({
    queryKey: ['seating', workspace.id, ceremony?.id],
    enabled: !isPreview && Boolean(ceremony?.id),
    queryFn: async () => {
      const ceremonyId = ceremony!.id
      const [tablesResult, invitationsResult, assignmentsResult] = await Promise.all([
        supabase!.from('seating_tables').select('id,name,capacity,is_locked').eq('workspace_id', workspace.id).eq('ceremony_id', ceremonyId).is('deleted_at', null).order('created_at'),
        supabase!.from('guest_invitations').select('guest_id').eq('workspace_id', workspace.id).eq('ceremony_id', ceremonyId).eq('rsvp_status', 'accepted').is('deleted_at', null),
        supabase!.from('seating_assignments').select('guest_id,table_id').eq('workspace_id', workspace.id).eq('ceremony_id', ceremonyId).is('deleted_at', null),
      ])
      if (tablesResult.error) throw tablesResult.error
      if (invitationsResult.error) throw invitationsResult.error
      if (assignmentsResult.error) throw assignmentsResult.error

      const guestIds = invitationsResult.data.map((invitation) => invitation.guest_id)
      let guestRows: Array<{ id: string; full_name: string; guest_tag_assignments: Array<{ guest_tags: Array<{ name: string }> }> }> = []
      if (guestIds.length) {
        const { data, error } = await supabase!.from('guests').select('id,full_name,guest_tag_assignments(guest_tags(name))').eq('workspace_id', workspace.id).in('id', guestIds).is('deleted_at', null).order('full_name')
        if (error) throw error
        guestRows = data
      }

      const assignments = new Map(assignmentsResult.data.map((assignment) => [assignment.guest_id, assignment.table_id]))
      return {
        tables: tablesResult.data.map((table) => ({ id: table.id, name: table.name, capacity: table.capacity, locked: table.is_locked })),
        guests: guestRows.map((guest) => ({
          id: guest.id,
          name: guest.full_name,
          tags: guest.guest_tag_assignments.map((assignment) => relationOne(assignment.guest_tags)?.name).filter(Boolean) as string[],
          tableId: assignments.get(guest.id) ?? null,
        })),
      }
    },
  })

  const persistMutation = useMutation({
    mutationFn: async (operation: PersistOperation) => {
      if (!ceremony) throw new Error(`Set up the ${event} ceremony before managing seating.`)
      if (operation.type === 'add-table') {
        const { error } = await supabase!.from('seating_tables').insert({ workspace_id: workspace.id, ceremony_id: ceremony.id, name: operation.name, capacity: operation.capacity, created_by: userId, updated_by: userId })
        if (error) throw error
        return
      }
      if (operation.type === 'set-lock') {
        const { error } = await supabase!.from('seating_tables').update({ is_locked: operation.locked, updated_by: userId }).eq('workspace_id', workspace.id).eq('id', operation.tableId).is('deleted_at', null)
        if (error) throw error
        return
      }

      if (operation.tableId === null) {
        const { error } = await supabase!.rpc('unseat_guests', { target_ceremony_id: ceremony.id, target_guest_ids: operation.guestIds })
        if (error) throw error
        return
      }
      const { error } = await supabase!.rpc('assign_guests_to_table', { target_table_id: operation.tableId, target_guest_ids: operation.guestIds })
      if (error) throw error
    },
    onSuccess: () => {
      setSelected([])
      void queryClient.invalidateQueries({ queryKey: ['seating', workspace.id, ceremony?.id] })
    },
  })

  const tables = isPreview ? previewTables[event] : seatingQuery.data?.tables ?? []
  const guests = isPreview ? previewGuests[event] : seatingQuery.data?.guests ?? []
  const waiting = guests.filter((guest) => !guest.tableId)
  const busy = persistMutation.isPending
  const dataError = operationError || ceremoniesQuery.error?.message || seatingQuery.error?.message || persistMutation.error?.message

  function addTable(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    setOperationError('')
    const name = tableName.trim()
    const tableCapacity = Number(capacity)
    if (!name) return
    if (!Number.isInteger(tableCapacity) || tableCapacity < 1) {
      setOperationError('Table capacity must be a positive whole number.')
      return
    }
    if (isPreview) {
      setPreviewTables((current) => ({ ...current, [event]: [...current[event], { id: crypto.randomUUID(), name, capacity: tableCapacity, locked: false }] }))
      setTableName('')
      return
    }
    persistMutation.mutate({ type: 'add-table', name, capacity: tableCapacity }, { onSuccess: () => setTableName('') })
  }

  function setLock(table: Table) {
    setOperationError('')
    if (!table.locked) {
      const guestIds = guests.filter((guest) => guest.tableId === table.id).map((guest) => guest.id)
      setSelected((current) => current.filter((id) => !guestIds.includes(id)))
    }
    if (isPreview) {
      setPreviewTables((current) => ({ ...current, [event]: current[event].map((item) => item.id === table.id ? { ...item, locked: !item.locked } : item) }))
      return
    }
    persistMutation.mutate({ type: 'set-lock', tableId: table.id, locked: !table.locked })
  }

  function assign(tableId: string | null) {
    if (!selected.length) return
    setOperationError('')
    const target = tables.find((table) => table.id === tableId)
    if (target?.locked) {
      setOperationError(`${target.name} is locked.`)
      return
    }
    const selectedFromLockedTable = selected.some((id) => {
      const sourceTableId = guests.find((guest) => guest.id === id)?.tableId
      return tables.some((table) => table.id === sourceTableId && table.locked)
    })
    if (selectedFromLockedTable) {
      setOperationError('Unlock the source table before moving its guests.')
      return
    }
    if (target) {
      const currentCount = guests.filter((guest) => guest.tableId === tableId && !selected.includes(guest.id)).length
      if (currentCount + selected.length > target.capacity) {
        setOperationError(`${target.name} only has ${Math.max(target.capacity - currentCount, 0)} seat${target.capacity - currentCount === 1 ? '' : 's'} available.`)
        return
      }
    }
    if (isPreview) {
      setPreviewGuests((current) => ({ ...current, [event]: current[event].map((guest) => selected.includes(guest.id) ? { ...guest, tableId } : guest) }))
      setSelected([])
      return
    }
    persistMutation.mutate({ type: 'assign', guestIds: selected, tableId })
  }

  function selectTag(tag: string) {
    setSelected(waiting.filter((guest) => guest.tags.includes(tag)).map((guest) => guest.id))
  }

  function switchEvent(nextEvent: EventName) {
    setEvent(nextEvent)
    setSelected([])
    setOperationError('')
    persistMutation.reset()
  }

  const waitingTags = [...new Set(waiting.flatMap((guest) => guest.tags))]

  return <div className="page seating-page">
    <header className="page-header">
      <div><p className="eyebrow">Guest placement</p><h1>Seating</h1><p className="page-lead">Assign Traditional and White guests in bulk, then refine individual placements table by table.</p></div>
      <div className="event-switch"><button className={event === 'Traditional' ? 'active' : ''} type="button" onClick={() => switchEvent('Traditional')}>Traditional</button><button className={event === 'White' ? 'active' : ''} type="button" onClick={() => switchEvent('White')}>White</button></div>
    </header>
    {dataError && <p className="seating-data-error" role="alert">{dataError}</p>}
    <section className="seating-summary"><div><strong>{guests.length}</strong><span>Confirmed guests</span></div><div><strong>{guests.length - waiting.length}</strong><span>Seated</span></div><div><strong>{waiting.length}</strong><span>Waiting</span></div><div><strong>{tables.length}</strong><span>Tables</span></div></section>
    <div className="seating-tools"><form onSubmit={addTable}><Armchair size={15} /><input value={tableName} onChange={(change) => setTableName(change.target.value)} placeholder="Table name" /><input type="number" min="1" step="1" value={capacity} onChange={(change) => setCapacity(change.target.value)} aria-label="Capacity" /><button type="submit" disabled={busy || (!isPreview && !ceremony)}>{busy ? 'Saving...' : 'Add table'}</button></form></div>
    <div className="seating-workspace">
      <aside className="waiting-list">
        <header><div><p className="eyebrow">Waiting list</p><h2>Unseated guests</h2></div><span>{selected.length} selected</span></header>
        {waitingTags.length > 0 && <div className="tag-actions">{waitingTags.map((tag) => <button type="button" key={tag} onClick={() => selectTag(tag)}>Select {tag}</button>)}</div>}
        <div>{waiting.length ? waiting.map((guest) => <label className="seat-guest" key={guest.id}><input type="checkbox" checked={selected.includes(guest.id)} onChange={(change) => setSelected((current) => change.target.checked ? [...current, guest.id] : current.filter((id) => id !== guest.id))} /><span><strong>{guest.name}</strong><small>{guest.tags.join(', ') || 'No tag'}</small></span></label>) : <div className="seat-empty"><Users size={19} /><p>{seatingQuery.isLoading ? 'Loading accepted guests...' : 'Accepted guests from the Guest List will appear here.'}</p></div>}</div>
      </aside>
      <section className="table-grid">{tables.length ? tables.map((table) => {
        const seated = guests.filter((guest) => guest.tableId === table.id)
        const full = seated.length >= table.capacity
        return <article className={`seating-table${table.locked ? ' locked' : ''}`} key={table.id}>
          <header><div><h2>{table.name}</h2><span className={full ? 'capacity-full' : ''}>{seated.length} / {table.capacity}</span></div><button type="button" disabled={busy} aria-label={table.locked ? 'Unlock table' : 'Lock table'} onClick={() => setLock(table)}>{table.locked ? <Lock size={14} /> : <Unlock size={14} />}</button></header>
          <div className="seated-list">{seated.map((guest) => <label className="seat-guest" key={guest.id}><input type="checkbox" disabled={table.locked} checked={selected.includes(guest.id)} onChange={(change) => setSelected((current) => change.target.checked ? [...current, guest.id] : current.filter((id) => id !== guest.id))} /><span><strong>{guest.name}</strong><small>{guest.tags.join(', ') || 'No tag'}</small></span></label>)}{!seated.length && <p>No guests assigned.</p>}</div>
          <button className="assign-button" type="button" disabled={!selected.length || busy || full || table.locked} onClick={() => assign(table.id)}><Plus size={13} /> Assign selected</button>
        </article>
      }) : <div className="tables-empty"><Armchair size={24} /><h2>No {event.toLocaleLowerCase()} tables</h2><p>{!isPreview && !ceremony ? `Set up the ${event} ceremony first.` : 'Create the first table above, then select waiting guests to assign them.'}</p></div>}</section>
    </div>
    {selected.some((id) => guests.find((guest) => guest.id === id)?.tableId) && <button className="button secondary unseat-button" type="button" disabled={busy} onClick={() => assign(null)}>Move selected to waiting list</button>}
  </div>
}
