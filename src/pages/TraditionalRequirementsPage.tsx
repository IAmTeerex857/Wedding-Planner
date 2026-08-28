import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleDollarSign, PackageCheck, Pencil, Plus, Truck, X } from '../components/KoboyoIcon'
import { formatNaira } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import './logistics.css'

type RequirementStatus = 'required' | 'ordered' | 'sourced' | 'delivered' | 'approved'
type Requirement = { id: string; paymentIds?: string[]; item: string; category: string; quantity: number; unit: string; owner: string; supplier: string; estimated: number; actual: number; paid: number; due: string; recipient: string; status: RequirementStatus }

export function TraditionalRequirementsPage() {
  const { workspace, userId, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const [items, setItems] = useState<Requirement[]>([])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Requirement | null>(null)
  const requirementsQuery = useQuery({
    queryKey: ['traditional-requirements', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const [{ data: ceremony, error: ceremonyError }, { data: requirements, error: requirementsError }] = await Promise.all([
        supabase!.from('ceremonies').select('id').eq('workspace_id', workspace.id).eq('kind', 'traditional').single(),
        supabase!.from('traditional_requirements').select('id,item_name,category,required_quantity,unit,responsible_party,estimated_minor,actual_minor,due_date,status,delivery_recipient,notes,traditional_requirement_payments(id,amount_minor)').eq('workspace_id', workspace.id).is('deleted_at', null).order('created_at'),
      ])
      if (ceremonyError || requirementsError) throw ceremonyError ?? requirementsError
      return { ceremonyId: ceremony.id, requirements }
    },
  })
  const requirementMutation = useMutation({
    mutationFn: async (operation: { type: 'save'; item: Requirement; editing: boolean } | { type: 'status'; id: string; status: RequirementStatus }) => {
      if (operation.type === 'status') {
        const { error } = await supabase!.from('traditional_requirements').update({ status: operation.status === 'required' ? 'outstanding' : operation.status, approval_status: operation.status === 'approved' ? 'accepted' : 'pending', updated_by: userId }).eq('id', operation.id)
        if (error) throw error
        return
      }
      const item = operation.item
      const actualMinor = item.actual ? Math.round(item.actual * 100) : null
      const status = item.status === 'required' ? 'outstanding' : item.status
      const values = { ceremony_id: requirementsQuery.data!.ceremonyId, category: item.category || 'General', item_name: item.item, required_quantity: item.quantity, unit: item.unit, responsible_party: item.owner || null, estimated_minor: item.estimated ? Math.round(item.estimated * 100) : null, actual_minor: actualMinor, currency: 'NGN', exchange_rate: actualMinor ? 1 : null, rate_source: actualMinor ? 'native' : null, rate_retrieved_at: actualMinor ? new Date().toISOString() : null, ngn_actual_minor: actualMinor, due_date: item.due || null, status, approval_status: item.status === 'approved' ? 'accepted' : 'pending', delivery_recipient: item.recipient || null, notes: item.supplier ? `Supplier: ${item.supplier}` : null, updated_by: userId }
      const result = operation.editing
        ? await supabase!.from('traditional_requirements').update(values).eq('workspace_id', workspace.id).eq('id', item.id).select('id').single()
        : await supabase!.from('traditional_requirements').insert({ workspace_id: workspace.id, ...values, created_by: userId }).select('id').single()
      const { data, error } = result
      if (error) throw error
      const amountMinor = Math.round(item.paid * 100)
      const paymentIds = item.paymentIds ?? []
      if (operation.editing && amountMinor <= 0 && paymentIds.length) {
        const { error: paymentError } = await supabase!.from('traditional_requirement_payments').delete().eq('workspace_id', workspace.id).in('id', paymentIds)
        if (paymentError) throw paymentError
      } else if (operation.editing && amountMinor > 0 && paymentIds.length) {
        const now = new Date()
        const { error: paymentError } = await supabase!.from('traditional_requirement_payments').update({ amount_minor: amountMinor, ngn_minor: amountMinor, exchange_rate: 1, rate_source: 'native', rate_retrieved_at: now.toISOString(), updated_by: userId }).eq('workspace_id', workspace.id).eq('id', paymentIds[0])
        if (paymentError) throw paymentError
        if (paymentIds.length > 1) {
          const { error: extraPaymentError } = await supabase!.from('traditional_requirement_payments').delete().eq('workspace_id', workspace.id).in('id', paymentIds.slice(1))
          if (extraPaymentError) throw extraPaymentError
        }
      } else if (amountMinor > 0) {
        const { error: paymentError } = await supabase!.from('traditional_requirement_payments').insert({ workspace_id: workspace.id, requirement_id: data.id, amount_minor: Math.round(item.paid * 100), currency: 'NGN', paid_on: new Date().toISOString().slice(0, 10), exchange_rate: 1, rate_source: 'native', rate_retrieved_at: new Date().toISOString(), ngn_minor: Math.round(item.paid * 100), created_by: userId, updated_by: userId })
        if (paymentError) throw paymentError
      }
    },
    onSuccess: (_data, operation) => {
      void queryClient.invalidateQueries({ queryKey: ['traditional-requirements', workspace.id] })
      if (operation.type === 'save') { setAdding(false); setEditing(null) }
    },
  })

  // oxlint-disable react/set-state-in-effect
  useEffect(() => {
    if (!requirementsQuery.data) return
    setItems((requirementsQuery.data.requirements ?? []).map((item) => ({ id: item.id, paymentIds: (item.traditional_requirement_payments ?? []).map((payment) => payment.id), item: item.item_name, category: item.category, quantity: Number(item.required_quantity), unit: item.unit, owner: item.responsible_party ?? '', supplier: item.notes?.replace(/^Supplier:\s*/i, '') ?? '', estimated: (item.estimated_minor ?? 0) / 100, actual: (item.actual_minor ?? 0) / 100, paid: (item.traditional_requirement_payments ?? []).reduce((sum, payment) => sum + payment.amount_minor, 0) / 100, due: item.due_date ?? '', recipient: item.delivery_recipient ?? '', status: item.status === 'outstanding' ? 'required' : item.status === 'complete' ? 'approved' : item.status as RequirementStatus })))
  }, [requirementsQuery.data])
  // oxlint-enable react/set-state-in-effect
  const estimated = items.reduce((sum, item) => sum + item.estimated, 0)
  const actual = items.reduce((sum, item) => sum + item.actual, 0)
  const paid = items.reduce((sum, item) => sum + item.paid, 0)

  return <div className="page logistics-page">
    <header className="page-header"><div><p className="eyebrow">Traditional ceremony</p><h1>Requirements</h1><p className="page-lead">Itemise what is required, who is sourcing it, what it costs, and whether it has been delivered and accepted.</p></div><button className="button primary" type="button" onClick={() => { requirementMutation.reset(); setEditing(null); setAdding(true) }}><Plus size={15} /> Add requirement</button></header>
    <section className="logistics-summary"><Summary icon={PackageCheck} value={String(items.length)} label="Required items" /><Summary icon={CircleDollarSign} value={formatNaira(estimated)} label="Estimated" /><Summary icon={CircleDollarSign} value={formatNaira(actual - paid)} label="Outstanding" /><Summary icon={CheckCircle2} value={String(items.filter((item) => item.status === 'approved').length)} label="Approved" /></section>
    {adding && <RequirementForm key={editing?.id ?? 'new-requirement'} initial={editing ?? undefined} saving={requirementMutation.isPending} onClose={() => { setAdding(false); setEditing(null) }} onSave={(item) => { const isEditing = Boolean(editing); if (isPreview) { setItems((current) => isEditing ? current.map((record) => record.id === item.id ? item : record) : [item, ...current]); setAdding(false); setEditing(null) } else requirementMutation.mutate({ type: 'save', item, editing: isEditing }) }} />}
    {(requirementsQuery.error || requirementMutation.error) && <p className="logistics-error">{requirementsQuery.error?.message ?? requirementMutation.error?.message}</p>}
    <section className="record-table trad-table"><div className="trad-head"><span>Requirement</span><span>Responsibility</span><span>Cost</span><span>Delivery</span><span>Status</span><span className="sr-only">Actions</span></div>{items.length ? items.map((item) => <article className="trad-row" key={item.id}><div><strong>{item.item}</strong><small>{item.quantity} {item.unit} / {item.category}</small></div><div><strong>{item.owner || 'Unassigned'}</strong><small>{item.supplier || 'No supplier'}</small></div><div><strong>{formatNaira(item.actual || item.estimated)}</strong><small>{formatNaira(Math.max(item.actual - item.paid, 0))} due</small></div><div><strong>{item.due || 'No due date'}</strong><small>{item.recipient || 'No recipient'}</small></div><select value={item.status} onChange={(event) => { const status = event.target.value as RequirementStatus; setItems((current) => current.map((record) => record.id === item.id ? { ...record, status } : record)); if (!isPreview) requirementMutation.mutate({ type: 'status', id: item.id, status }) }}><option value="required">Required</option><option value="ordered">Ordered</option><option value="sourced">Sourced</option><option value="delivered">Delivered</option><option value="approved">Approved</option></select><button className="record-edit" type="button" aria-label={`Edit ${item.item}`} onClick={() => { requirementMutation.reset(); setEditing(item); setAdding(true) }}><Pencil size={13} /></button></article>) : <div className="record-empty"><Truck size={20} /><h2>No requirements listed</h2><p>Add the first item from the engagement or family list.</p></div>}</section>
  </div>
}

function Summary({ icon: Icon, value, label }: { icon: typeof PackageCheck; value: string; label: string }) { return <div><Icon size={15} /><strong>{value}</strong><span>{label}</span></div> }

function RequirementForm({ initial, saving, onClose, onSave }: { initial?: Requirement; saving: boolean; onClose: () => void; onSave: (item: Requirement) => void }) {
  const [draft, setDraft] = useState({ item: initial?.item ?? '', category: initial?.category ?? '', quantity: initial ? String(initial.quantity) : '1', unit: initial?.unit ?? 'pieces', owner: initial?.owner ?? '', supplier: initial?.supplier ?? '', estimated: initial ? String(initial.estimated) : '', actual: initial ? String(initial.actual) : '', paid: initial ? String(initial.paid) : '', due: initial?.due ?? '', recipient: initial?.recipient ?? '', status: initial?.status ?? 'required' as RequirementStatus })
  const set = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  function submit(event: FormEvent) { event.preventDefault(); if (!draft.item.trim()) return; onSave({ id: initial?.id ?? crypto.randomUUID(), paymentIds: initial?.paymentIds, item: draft.item.trim(), category: draft.category.trim(), quantity: Number(draft.quantity) || 1, unit: draft.unit.trim(), owner: draft.owner.trim(), supplier: draft.supplier.trim(), estimated: Number(draft.estimated) || 0, actual: Number(draft.actual) || 0, paid: Number(draft.paid) || 0, due: draft.due, recipient: draft.recipient.trim(), status: draft.status }) }
  return <section className="logistics-entry"><header><div><p className="eyebrow">Traditional list</p><h2>{initial ? 'Edit requirement' : 'New requirement'}</h2></div><button type="button" onClick={onClose} aria-label="Close"><X size={17} /></button></header><form onSubmit={submit}><div className="logistics-fields"><Field label="Item"><input value={draft.item} onChange={(e) => set('item', e.target.value)} required /></Field><Field label="Category"><input value={draft.category} onChange={(e) => set('category', e.target.value)} /></Field><Field label="Quantity"><input type="number" min="1" value={draft.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field><Field label="Unit"><input value={draft.unit} onChange={(e) => set('unit', e.target.value)} /></Field><Field label="Sourcing owner"><input value={draft.owner} onChange={(e) => set('owner', e.target.value)} /></Field><Field label="Supplier"><input value={draft.supplier} onChange={(e) => set('supplier', e.target.value)} /></Field><Field label="Estimated NGN"><input type="number" min="0" value={draft.estimated} onChange={(e) => set('estimated', e.target.value)} /></Field><Field label="Actual NGN"><input type="number" min="0" value={draft.actual} onChange={(e) => set('actual', e.target.value)} /></Field><Field label="Paid NGN"><input type="number" min="0" value={draft.paid} onChange={(e) => set('paid', e.target.value)} /></Field><Field label="Due date"><input type="date" value={draft.due} onChange={(e) => set('due', e.target.value)} /></Field><Field label="Delivery recipient"><input value={draft.recipient} onChange={(e) => set('recipient', e.target.value)} /></Field><Field label="Status"><select value={draft.status} onChange={(e) => set('status', e.target.value)}><option value="required">Required</option><option value="ordered">Ordered</option><option value="sourced">Sourced</option><option value="delivered">Delivered</option><option value="approved">Approved</option></select></Field></div><footer><button className="button secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={saving}>{saving ? 'Saving...' : initial ? 'Save changes' : 'Save requirement'}</button></footer></form></section>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="logistics-field"><span>{label}</span>{children}</label> }
