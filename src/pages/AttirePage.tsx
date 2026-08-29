import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, CircleDollarSign, Pencil, Plus, Shirt, Truck, X } from '../components/KoboyoIcon'
import { formatNaira } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import './logistics.css'

type OrderStatus = 'ordered' | 'fitting' | 'ready' | 'collected'
type Ceremony = { id: string; kind: string }

type StockItem = {
  id: string
  groupId?: string
  name: string
  group: string
  unit: string
  ordered: number
  received: number
  distributed: number
  unitCost: number
  unitPrice: number
}

type AttireOrder = {
  id: string
  orderItemId?: string
  paymentIds?: string[]
  recipient: string
  group: string
  event: string
  look: string
  item: string
  quantity: number
  total: number
  paid: number
  tailor: string
  status: OrderStatus
}

const defaultGroups = ['Aso-ebi / Bride family', 'Aso-ebi / Groom family', 'Aso-ebi / Friends', 'Groomsmen', 'Bridesmaids', 'Parents & family', 'Couple']
const units = ['yards', 'pieces', 'sets', 'bundles']
const previewCeremonies: Ceremony[] = ['court', 'traditional', 'white'].map((kind) => ({ id: kind, kind }))
const databaseStatus: Record<OrderStatus, string> = { ordered: 'confirmed', fitting: 'in_production', ready: 'ready', collected: 'completed' }

function uiStatus(status: string): OrderStatus {
  if (status === 'in_production') return 'fitting'
  if (status === 'ready' || status === 'part_distributed') return 'ready'
  if (status === 'completed') return 'collected'
  return 'ordered'
}

function groupType(name: string) {
  const value = name.toLowerCase()
  if (value.startsWith('aso-ebi')) return 'aso_ebi'
  if (value === 'groomsmen' || value === 'bridesmaids' || value === 'couple') return value
  if (value.includes('parent')) return 'parents'
  if (value.includes('family')) return 'family'
  return 'other'
}

function noteValue(notes: string | null, label: string) {
  return notes?.split('\n').find((line) => line.startsWith(`${label}: `))?.slice(label.length + 2) ?? ''
}

function firstRelation<T>(relation: T | T[] | null | undefined) {
  return Array.isArray(relation) ? relation[0] : relation ?? undefined
}

export function AttirePage() {
  const { workspace, userId, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'orders' | 'inventory'>('orders')
  const [orders, setOrders] = useState<AttireOrder[]>([])
  const [stock, setStock] = useState<StockItem[]>([])
  const [form, setForm] = useState<'order' | 'stock' | null>(null)
  const [editingOrder, setEditingOrder] = useState<AttireOrder | null>(null)
  const [editingStock, setEditingStock] = useState<StockItem | null>(null)

  const attireQuery = useQuery({
    queryKey: ['attire', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const [ceremoniesResult, groupsResult, itemsResult, ordersResult] = await Promise.all([
        supabase!.from('ceremonies').select('id,kind').eq('workspace_id', workspace.id).is('deleted_at', null).order('kind'),
        supabase!.from('attire_groups').select('id,name').eq('workspace_id', workspace.id).is('deleted_at', null).order('name'),
        supabase!.from('attire_items').select('id,attire_group_id,name,unit,quantity_ordered,quantity_received,unit_cost_minor,selling_price_minor,attire_inventory_movements(movement_type,quantity_delta)').eq('workspace_id', workspace.id).is('deleted_at', null).order('created_at', { ascending: false }),
        supabase!.from('attire_orders').select('id,recipient_name,status,agreed_total_minor,notes,ceremonies(kind),attire_groups(name),attire_order_items(id,quantity,unit,unit_price_minor,attire_items(id,name)),attire_payments(id,amount_minor)').eq('workspace_id', workspace.id).is('deleted_at', null).order('created_at', { ascending: false }),
      ])
      const error = ceremoniesResult.error ?? groupsResult.error ?? itemsResult.error ?? ordersResult.error
      if (error) throw error
      return { ceremonies: ceremoniesResult.data ?? [], groups: groupsResult.data ?? [], items: itemsResult.data ?? [], orders: ordersResult.data ?? [] }
    },
  })

  async function findOrCreateGroup(name: string) {
    const { data: existing, error: findError } = await supabase!.from('attire_groups').select('id,name').eq('workspace_id', workspace.id).is('deleted_at', null)
    if (findError) throw findError
    const match = existing.find((group) => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (match) return match.id
    const { data, error } = await supabase!.from('attire_groups').insert({ workspace_id: workspace.id, name, group_type: groupType(name), created_by: userId, updated_by: userId }).select('id').single()
    if (error) throw error
    return data.id
  }

  async function findOrCreateItem(item: Pick<StockItem, 'name' | 'group' | 'unit' | 'unitPrice'>, groupId: string) {
    const { data: existing, error: findError } = await supabase!.from('attire_items').select('id,name,unit,selling_price_minor').eq('workspace_id', workspace.id).eq('attire_group_id', groupId).is('deleted_at', null)
    if (findError) throw findError
    const match = existing.find((record) => record.name.toLocaleLowerCase() === item.name.toLocaleLowerCase())
    if (match) return match
    const { data, error } = await supabase!.from('attire_items').insert({ workspace_id: workspace.id, attire_group_id: groupId, name: item.name, item_type: 'attire', unit: item.unit, selling_price_minor: Math.round(item.unitPrice * 100), currency: 'NGN', created_by: userId, updated_by: userId }).select('id,name,unit,selling_price_minor').single()
    if (error) throw error
    return data
  }

  const attireMutation = useMutation({
    mutationFn: async (operation: { type: 'stock'; item: StockItem; editing: boolean } | { type: 'order'; order: AttireOrder; editing: boolean } | { type: 'status'; id: string; status: OrderStatus }) => {
      if (operation.type === 'status') {
        const { error } = await supabase!.from('attire_orders').update({ status: databaseStatus[operation.status], updated_by: userId }).eq('workspace_id', workspace.id).eq('id', operation.id)
        if (error) throw error
        return
      }

      const groupId = await findOrCreateGroup(operation.type === 'stock' ? operation.item.group : operation.order.group)
      if (operation.type === 'stock') {
        const item = operation.item
        const values = { attire_group_id: groupId, name: item.name, item_type: 'attire', unit: item.unit, quantity_ordered: item.ordered, quantity_received: item.received, unit_cost_minor: Math.round(item.unitCost * 100), selling_price_minor: Math.round(item.unitPrice * 100), currency: 'NGN', updated_by: userId }
        const result = operation.editing
          ? await supabase!.from('attire_items').update(values).eq('workspace_id', workspace.id).eq('id', item.id).select('id').single()
          : await supabase!.from('attire_items').insert({ workspace_id: workspace.id, ...values, created_by: userId }).select('id').single()
        const { data, error } = result
        if (error) throw error
        if (!operation.editing && item.received > 0) {
          const { error: movementError } = await supabase!.from('attire_inventory_movements').insert({ workspace_id: workspace.id, attire_item_id: data.id, movement_type: 'receipt', quantity_delta: item.received, reason: 'Initial stock received', created_by: userId, updated_by: userId })
          if (movementError) throw movementError
        }
        return
      }

      const order = operation.order
      const ceremony = attireQuery.data?.ceremonies.find((record) => record.kind === order.event)
      if (!ceremony) throw new Error(`No ${order.event} ceremony exists in this workspace.`)
      const unitPrice = order.quantity ? order.total / order.quantity : 0
      const item = await findOrCreateItem({ name: order.item, group: order.group, unit: 'pieces', unitPrice }, groupId)
      const paidMinor = Math.round(order.paid * 100)
      const totalMinor = Math.round(order.total * 100)
      const paymentStatus = paidMinor <= 0 ? 'unpaid' : totalMinor > 0 && paidMinor >= totalMinor ? 'paid' : 'deposit_paid'
      const notes = [order.look && `Look: ${order.look}`, order.tailor && `Tailor: ${order.tailor}`].filter(Boolean).join('\n') || null
      const values = { ceremony_id: ceremony.id, attire_group_id: groupId, recipient_name: order.recipient, status: databaseStatus[order.status], payment_status: paymentStatus, currency: 'NGN', agreed_total_minor: totalMinor, notes, updated_by: userId }
      const result = operation.editing
        ? await supabase!.from('attire_orders').update(values).eq('workspace_id', workspace.id).eq('id', order.id).select('id').single()
        : await supabase!.from('attire_orders').insert({ workspace_id: workspace.id, ...values, created_by: userId }).select('id').single()
      const { data: created, error } = result
      if (error) throw error
      const orderItemValues = { attire_item_id: item.id, quantity: order.quantity, unit: item.unit, unit_price_minor: Math.round(unitPrice * 100), updated_by: userId }
      const { error: itemError } = operation.editing && order.orderItemId
        ? await supabase!.from('attire_order_items').update(orderItemValues).eq('workspace_id', workspace.id).eq('id', order.orderItemId)
        : await supabase!.from('attire_order_items').insert({ workspace_id: workspace.id, attire_order_id: created.id, ...orderItemValues, created_by: userId })
      if (itemError) {
        if (!operation.editing) await supabase!.from('attire_orders').delete().eq('id', created.id)
        throw itemError
      }
      const paymentIds = order.paymentIds ?? []
      if (operation.editing && paidMinor <= 0 && paymentIds.length) {
        const { error: paymentError } = await supabase!.from('attire_payments').delete().eq('workspace_id', workspace.id).in('id', paymentIds)
        if (paymentError) throw paymentError
      } else if (operation.editing && paidMinor > 0 && paymentIds.length) {
        const now = new Date()
        const { error: paymentError } = await supabase!.from('attire_payments').update({ amount_minor: paidMinor, ngn_minor: paidMinor, exchange_rate: 1, rate_source: 'native', rate_retrieved_at: now.toISOString(), updated_by: userId }).eq('workspace_id', workspace.id).eq('id', paymentIds[0])
        if (paymentError) throw paymentError
        if (paymentIds.length > 1) {
          const { error: extraPaymentError } = await supabase!.from('attire_payments').delete().eq('workspace_id', workspace.id).in('id', paymentIds.slice(1))
          if (extraPaymentError) throw extraPaymentError
        }
      } else if (paidMinor > 0) {
        const now = new Date()
        const { error: paymentError } = await supabase!.from('attire_payments').insert({ workspace_id: workspace.id, attire_order_id: created.id, amount_minor: paidMinor, currency: 'NGN', paid_on: now.toISOString().slice(0, 10), exchange_rate: 1, rate_source: 'native', rate_retrieved_at: now.toISOString(), ngn_minor: paidMinor, created_by: userId, updated_by: userId })
        if (paymentError) {
          await supabase!.from('attire_orders').delete().eq('id', created.id)
          throw paymentError
        }
      }
    },
    onSuccess: (_data, operation) => {
      void queryClient.invalidateQueries({ queryKey: ['attire', workspace.id] })
      if (operation.type !== 'status') { setForm(null); setEditingOrder(null); setEditingStock(null) }
    },
    onError: (_error, operation) => {
      if (operation.type === 'status') void queryClient.invalidateQueries({ queryKey: ['attire', workspace.id] })
    },
  })

  // oxlint-disable react/set-state-in-effect
  useEffect(() => {
    if (!attireQuery.data) return
    const groupNames = new Map(attireQuery.data.groups.map((group) => [group.id, group.name]))
    setStock(attireQuery.data.items.map((item) => {
      const movements = item.attire_inventory_movements ?? []
      const distributions = movements.filter((movement) => movement.movement_type === 'distribution').reduce((sum, movement) => sum + Number(movement.quantity_delta), 0)
      return { id: item.id, groupId: item.attire_group_id ?? undefined, name: item.name, group: groupNames.get(item.attire_group_id) ?? 'Ungrouped', unit: item.unit, ordered: Number(item.quantity_ordered), received: Number(item.quantity_received), distributed: Math.abs(distributions), unitCost: (item.unit_cost_minor ?? 0) / 100, unitPrice: (item.selling_price_minor ?? 0) / 100 }
    }))
    setOrders(attireQuery.data.orders.map((order) => {
      const orderItem = order.attire_order_items?.[0]
      const group = firstRelation(order.attire_groups)
      const ceremony = firstRelation(order.ceremonies)
      const item = firstRelation(orderItem?.attire_items)
      return { id: order.id, orderItemId: orderItem?.id, paymentIds: (order.attire_payments ?? []).map((payment) => payment.id), recipient: order.recipient_name, group: group?.name ?? 'Ungrouped', event: ceremony?.kind ?? '', look: noteValue(order.notes, 'Look'), item: item?.name ?? 'Unspecified item', quantity: Number(orderItem?.quantity ?? 0), total: order.agreed_total_minor / 100, paid: (order.attire_payments ?? []).reduce((sum, payment) => sum + payment.amount_minor, 0) / 100, tailor: noteValue(order.notes, 'Tailor'), status: uiStatus(order.status) }
    }))
  }, [attireQuery.data])
  // oxlint-enable react/set-state-in-effect

  const revenue = orders.reduce((sum, order) => sum + order.paid, 0)
  const receivable = orders.reduce((sum, order) => sum + Math.max(order.total - order.paid, 0), 0)
  const stockCost = stock.reduce((sum, item) => sum + item.received * item.unitCost, 0)
  const groupOptions = [...new Set([...defaultGroups, ...(attireQuery.data?.groups.map((group) => group.name) ?? [])])]
  const ceremonyOptions = isPreview ? previewCeremonies : attireQuery.data?.ceremonies ?? []
  const error = attireQuery.error?.message ?? attireMutation.error?.message

  function addOrder(order: AttireOrder) {
    const editing = Boolean(editingOrder)
    if (isPreview) { setOrders((current) => editing ? current.map((item) => item.id === order.id ? order : item) : [order, ...current]); setForm(null); setEditingOrder(null) }
    else attireMutation.mutate({ type: 'order', order, editing })
  }

  function addStock(item: StockItem) {
    const editing = Boolean(editingStock)
    if (isPreview) { setStock((current) => editing ? current.map((record) => record.id === item.id ? item : record) : [item, ...current]); setForm(null); setEditingStock(null) }
    else attireMutation.mutate({ type: 'stock', item, editing })
  }

  return (
    <div className="page logistics-page ui-page">
      <header className="page-header">
        <div><p className="eyebrow">Looks, fabric & fulfilment</p><h1>Attire & aso-ebi</h1><p className="page-lead">Control every fabric order, outfit, payment, fitting, collection, and distribution without storing body measurements.</p></div>
        <div className="header-actions"><button className="button secondary" type="button" onClick={() => { attireMutation.reset(); setEditingOrder(null); setEditingStock(null); setForm('stock') }}><Boxes size={15} /> Add stock</button><button className="button primary" type="button" onClick={() => { attireMutation.reset(); setEditingOrder(null); setEditingStock(null); setForm('order') }}><Plus size={15} /> New order</button></div>
      </header>

      <section className="logistics-summary">
        <Summary icon={Shirt} value={String(orders.length)} label="Outfit orders" />
        <Summary icon={CircleDollarSign} value={formatNaira(revenue)} label="Payments received" />
        <Summary icon={CircleDollarSign} value={formatNaira(receivable)} label="Outstanding" />
        <Summary icon={Truck} value={formatNaira(stockCost)} label="Inventory cost" />
      </section>

      {form === 'order' && <OrderForm key={editingOrder?.id ?? 'new-order'} initial={editingOrder ?? undefined} items={stock} groups={groupOptions} ceremonies={ceremonyOptions} saving={attireMutation.isPending} onClose={() => { setForm(null); setEditingOrder(null) }} onAdd={addOrder} />}
      {form === 'stock' && <StockForm key={editingStock?.id ?? 'new-stock'} initial={editingStock ?? undefined} groups={groupOptions} saving={attireMutation.isPending} onClose={() => { setForm(null); setEditingStock(null) }} onAdd={addStock} />}
      {error && <p className="logistics-error">{error}</p>}

      <div className="record-tabs"><button type="button" className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>Orders <span>{orders.length}</span></button><button type="button" className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>Inventory <span>{stock.length}</span></button></div>

      {tab === 'orders' ? (
        <section className="record-table">
          <div className="attire-order-head"><span>Recipient</span><span>Group / event</span><span>Order</span><span>Payment</span><span>Status</span><span className="sr-only">Actions</span></div>
          {orders.length ? orders.map((order) => (
            <article className="attire-order-row" key={order.id}>
              <div><strong>{order.recipient}</strong><small>{order.look || 'Primary look'}{order.tailor ? ` / ${order.tailor}` : ''}</small></div>
              <div><strong>{order.group}</strong><small>{order.event ? `${order.event[0].toUpperCase()}${order.event.slice(1)}` : 'No ceremony'}</small></div>
              <div><strong>{order.item}</strong><small>{order.quantity} unit{order.quantity === 1 ? '' : 's'}</small></div>
              <div><strong>{formatNaira(order.total)}</strong><small>{formatNaira(Math.max(order.total - order.paid, 0))} due</small></div>
              <select disabled={attireMutation.isPending} value={order.status} onChange={(event) => { const status = event.target.value as OrderStatus; setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status } : item)); if (!isPreview) attireMutation.mutate({ type: 'status', id: order.id, status }) }}><option value="ordered">Ordered</option><option value="fitting">Fitting</option><option value="ready">Ready</option><option value="collected">Collected</option></select>
              <button className="record-edit" type="button" aria-label={`Edit order for ${order.recipient}`} onClick={() => { attireMutation.reset(); setEditingStock(null); setEditingOrder(order); setForm('order') }}><Pencil size={13} /></button>
            </article>
          )) : <Empty title="No attire orders" detail="Add the first recipient, outfit, and payment arrangement." />}
        </section>
      ) : (
        <section className="record-table">
          <div className="stock-head"><span>Item</span><span>Ordered</span><span>Received</span><span>Distributed</span><span>Available</span><span className="sr-only">Actions</span></div>
          {stock.length ? stock.map((item) => {
            const available = item.received - item.distributed
            return <article className="stock-row" key={item.id}><div><strong>{item.name}</strong><small>{item.group}</small></div><span>{item.ordered} {item.unit}</span><span>{item.received} {item.unit}</span><span>{item.distributed} {item.unit}</span><strong className={available < 0 ? 'danger' : ''}>{available} {item.unit}</strong><button className="record-edit" type="button" aria-label={`Edit ${item.name}`} onClick={() => { attireMutation.reset(); setEditingOrder(null); setEditingStock(item); setForm('stock') }}><Pencil size={13} /></button></article>
          }) : <Empty title="No inventory" detail="Add fabric, accessories, or complete outfit stock." />}
        </section>
      )}
    </div>
  )
}

function Summary({ icon: Icon, value, label }: { icon: typeof Shirt; value: string; label: string }) {
  return <div><Icon size={15} /><strong>{value}</strong><span>{label}</span></div>
}

function OrderForm({ initial, items, groups, ceremonies, saving, onClose, onAdd }: { initial?: AttireOrder; items: StockItem[]; groups: string[]; ceremonies: Ceremony[]; saving: boolean; onClose: () => void; onAdd: (order: AttireOrder) => void }) {
  const [recipient, setRecipient] = useState(initial?.recipient ?? '')
  const [group, setGroup] = useState(initial?.group ?? groups[0] ?? defaultGroups[0])
  const [event, setEvent] = useState(initial?.event ?? ceremonies[0]?.kind ?? '')
  const [look, setLook] = useState(initial?.look ?? '')
  const [item, setItem] = useState(initial?.item ?? '')
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : '1')
  const [total, setTotal] = useState(initial ? String(initial.total) : '')
  const [paid, setPaid] = useState(initial ? String(initial.paid) : '')
  const [tailor, setTailor] = useState(initial?.tailor ?? '')
  const [status, setStatus] = useState<OrderStatus>(initial?.status ?? 'ordered')

  function submit(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    if (!recipient.trim() || !item.trim() || !event) return
    onAdd({ id: initial?.id ?? crypto.randomUUID(), orderItemId: initial?.orderItemId, paymentIds: initial?.paymentIds, recipient: recipient.trim(), group, event, look: group === 'Couple' ? look.trim() : '', item: item.trim(), quantity: Number(quantity) || 1, total: Number(total) || 0, paid: Number(paid) || 0, tailor: tailor.trim(), status })
  }

  return <EntryPanel title={initial ? 'Edit attire order' : 'New attire order'} editing={Boolean(initial)} saving={saving} onClose={onClose} onSubmit={submit}><Field label="Recipient"><input value={recipient} onChange={(e) => setRecipient(e.target.value)} required /></Field><Field label="Group"><select value={group} onChange={(e) => setGroup(e.target.value)}>{groups.map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Ceremony"><select value={event} onChange={(e) => setEvent(e.target.value)} required><option value="" disabled>Select ceremony</option>{ceremonies.map((ceremony) => <option value={ceremony.kind} key={ceremony.id}>{ceremony.kind[0].toUpperCase()}{ceremony.kind.slice(1)}</option>)}</select></Field>{group === 'Couple' && <Field label="Look name"><input value={look} onChange={(e) => setLook(e.target.value)} placeholder="Ceremony, reception..." /></Field>}<Field label="Item"><input value={item} onChange={(e) => setItem(e.target.value)} list="stock-items" required /><datalist id="stock-items">{items.filter((value) => value.group === group).map((value) => <option value={value.name} key={value.id} />)}</datalist></Field><Field label="Quantity"><input type="number" min="0.001" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field><Field label="Total NGN"><input type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} /></Field><Field label="Paid NGN"><input type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field><Field label="Tailor / designer"><input value={tailor} onChange={(e) => setTailor(e.target.value)} /></Field><Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}><option value="ordered">Ordered</option><option value="fitting">Fitting</option><option value="ready">Ready</option><option value="collected">Collected</option></select></Field></EntryPanel>
}

function StockForm({ initial, groups, saving, onClose, onAdd }: { initial?: StockItem; groups: string[]; saving: boolean; onClose: () => void; onAdd: (item: StockItem) => void }) {
  const [name, setName] = useState(initial?.name ?? ''); const [group, setGroup] = useState(initial?.group ?? groups[0] ?? defaultGroups[0]); const [unit, setUnit] = useState(initial?.unit ?? units[0]); const [ordered, setOrdered] = useState(initial ? String(initial.ordered) : ''); const [received, setReceived] = useState(initial ? String(initial.received) : ''); const [unitCost, setUnitCost] = useState(initial ? String(initial.unitCost) : ''); const [unitPrice, setUnitPrice] = useState(initial ? String(initial.unitPrice) : '')
  function submit(event: FormEvent) { event.preventDefault(); if (!name.trim() || !unit.trim()) return; onAdd({ id: initial?.id ?? crypto.randomUUID(), groupId: initial?.groupId, name: name.trim(), group, unit: unit.trim(), ordered: Number(ordered) || 0, received: Number(received) || 0, distributed: initial?.distributed ?? 0, unitCost: Number(unitCost) || 0, unitPrice: Number(unitPrice) || 0 }) }
  return <EntryPanel title={initial ? 'Edit inventory' : 'Add inventory'} editing={Boolean(initial)} saving={saving} onClose={onClose} onSubmit={submit}><Field label="Fabric or item"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field><Field label="Group"><select value={group} onChange={(e) => setGroup(e.target.value)}>{groups.map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} list="attire-units" required /><datalist id="attire-units">{units.map((value) => <option value={value} key={value} />)}</datalist></Field><Field label="Ordered"><input type="number" min="0" step="any" value={ordered} onChange={(e) => setOrdered(e.target.value)} /></Field><Field label="Received"><input type="number" min="0" step="any" value={received} onChange={(e) => setReceived(e.target.value)} /></Field><Field label="Unit cost NGN"><input type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></Field><Field label="Selling price NGN"><input type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} /></Field></EntryPanel>
}

function EntryPanel({ title, editing = false, saving, onClose, onSubmit, children }: { title: string; editing?: boolean; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent) => void; children: React.ReactNode }) {
  return <section className="logistics-entry"><header><div><p className="eyebrow">{editing ? 'Edit record' : 'New record'}</p><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label="Close"><X size={17} /></button></header><form onSubmit={onSubmit}><div className="logistics-fields">{children}</div><footer><button className="button secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Save record'}</button></footer></form></section>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="logistics-field"><span>{label}</span>{children}</label> }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="record-empty"><Shirt size={20} /><h2>{title}</h2><p>{detail}</p></div> }
