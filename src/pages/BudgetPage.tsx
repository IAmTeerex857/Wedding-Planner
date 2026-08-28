import { useDeferredValue, useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  CircleDollarSign,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  WalletCards,
  X,
} from '../components/KoboyoIcon'
import './budget.css'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import { fetchNgnRate } from '../lib/exchange-rates'

type Currency = 'NGN' | 'USD' | 'GBP' | 'EUR'
type ExpenseStatus = 'planned' | 'due' | 'paid'
type ContributionStatus = 'pledged' | 'received'
type EntryStatus = ExpenseStatus | ContributionStatus
type EntryKind = 'expense' | 'contribution'

interface Allocation {
  id: string
  event: string
  amountNgn: number
}

interface MoneySource {
  currency: Currency
  originalAmount: number
  exchangeRate: number
  amountNgn: number
  rateSource: string
}

interface Expense extends MoneySource {
  id: string
  kind: 'expense'
  description: string
  category: string
  event: string
  status: ExpenseStatus
  date: string
}

interface Contribution extends MoneySource {
  id: string
  kind: 'contribution'
  contributor: string
  event: string
  status: ContributionStatus
  date: string
}

type LedgerEntry = Expense | Contribution
type FormMode = EntryKind | null

type FinanceOperation =
  | { type: 'allocation'; event: string; amount: number }
  | { type: 'allocation-save'; id: string; amount: number }
  | { type: 'allocation-delete'; id: string }
  | { type: 'entry'; entry: LedgerEntry; editing: boolean }
  | { type: 'status'; id: string; kind: EntryKind; status: EntryStatus }

const GENERAL_EVENT = 'General / shared'
const CURRENCIES: Currency[] = ['NGN', 'USD', 'GBP', 'EUR']

const currencyFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
})

const numberFormatter = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })

function formatNgn(value: number) {
  return currencyFormatter.format(value)
}

function formatOriginal(entry: MoneySource) {
  return `${entry.currency} ${numberFormatter.format(entry.originalAmount)}`
}

function toAmount(value: string) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : 0
}

function relationName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value
  if (!relation || typeof relation !== 'object' || !('name' in relation)) return null
  return String(relation.name).replace(/ Wedding$/i, '')
}

export function BudgetPage() {
  const { workspace, userId, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [editingEntry, setEditingEntry] = useState<LedgerEntry | null>(null)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | EntryKind>('all')
  const [eventFilter, setEventFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | EntryStatus>('all')
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())
  const financeQuery = useQuery({
    queryKey: ['finance', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const [{ data: budget, error: budgetError }, { data: ceremonies, error: ceremonyError }, { data: expenses, error: expenseError }, { data: contributions, error: contributionError }] = await Promise.all([
        supabase!.from('budgets').select('id').eq('workspace_id', workspace.id).is('deleted_at', null).maybeSingle(),
        supabase!.from('ceremonies').select('id,name').eq('workspace_id', workspace.id).is('deleted_at', null),
        supabase!.from('expenses').select('id,description,category,status,amount_minor,currency,transaction_date,exchange_rate,rate_source,ngn_minor,expense_ceremonies(ceremonies(name))').eq('workspace_id', workspace.id).is('deleted_at', null).order('transaction_date', { ascending: false }),
        supabase!.from('contributions').select('id,contributor_name,pledged_minor,received_minor,currency,exchange_rate,rate_source,ngn_received_minor,received_on,contribution_allocations(ceremonies(name))').eq('workspace_id', workspace.id).is('deleted_at', null).order('created_at', { ascending: false }),
      ])
      if (budgetError || ceremonyError || expenseError || contributionError) throw budgetError ?? ceremonyError ?? expenseError ?? contributionError
      let budgetAllocations: Array<{ id: string; category: string; planned_minor: number; ceremonies: Array<{ name: string }> }> = []
      if (budget) {
        const { data, error } = await supabase!.from('budget_allocations').select('id,category,planned_minor,ceremonies(name)').eq('budget_id', budget.id).is('deleted_at', null)
        if (error) throw error
        budgetAllocations = data
      }
      return { budget, ceremonies, allocations: budgetAllocations, expenses, contributions }
    },
  })
  const financeMutation = useMutation({
    mutationFn: async (operation: FinanceOperation) => {
      if (operation.type === 'allocation') {
        let budgetId = financeQuery.data?.budget?.id
        if (!budgetId) {
          const { data, error } = await supabase!.from('budgets').insert({ workspace_id: workspace.id, name: 'Wedding budget', reporting_currency: 'NGN', created_by: userId, updated_by: userId }).select('id').single()
          if (error) throw error
          budgetId = data.id
        }
        const ceremony = financeQuery.data?.ceremonies?.find((item) => item.name.replace(/ Wedding$/i, '').toLocaleLowerCase() === operation.event.toLocaleLowerCase())
        const { error } = await supabase!.from('budget_allocations').insert({ workspace_id: workspace.id, budget_id: budgetId, ceremony_id: ceremony?.id ?? null, category: ceremony ? 'Ceremony allocation' : operation.event, planned_minor: Math.round(operation.amount * 100), created_by: userId, updated_by: userId })
        if (error) throw error
      } else if (operation.type === 'allocation-save') {
        const { error } = await supabase!.from('budget_allocations').update({ planned_minor: Math.round(operation.amount * 100), updated_by: userId }).eq('workspace_id', workspace.id).eq('id', operation.id)
        if (error) throw error
      } else if (operation.type === 'allocation-delete') {
        const { error } = await supabase!.from('budget_allocations').update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq('workspace_id', workspace.id).eq('id', operation.id)
        if (error) throw error
      } else if (operation.type === 'entry') {
        const entry = operation.entry
        const ceremony = financeQuery.data?.ceremonies?.find((item) => item.name.replace(/ Wedding$/i, '').toLocaleLowerCase() === entry.event.toLocaleLowerCase())
        if (entry.kind === 'expense') {
          const values = { description: entry.description, category: entry.category, status: entry.status === 'due' ? 'committed' : entry.status, amount_minor: Math.round(entry.originalAmount * 100), currency: entry.currency, transaction_date: entry.date, exchange_rate: entry.exchangeRate, rate_source: entry.rateSource, rate_retrieved_at: new Date().toISOString(), ngn_minor: Math.round(entry.amountNgn * 100), updated_by: userId }
          const result = operation.editing
            ? await supabase!.from('expenses').update(values).eq('workspace_id', workspace.id).eq('id', entry.id).select('id').single()
            : await supabase!.from('expenses').insert({ workspace_id: workspace.id, ...values, created_by: userId }).select('id').single()
          const { data: created, error } = result
          if (error) throw error
          if (operation.editing) {
            const { error: unlinkError } = await supabase!.from('expense_ceremonies').delete().eq('workspace_id', workspace.id).eq('expense_id', entry.id)
            if (unlinkError) throw unlinkError
          }
          if (ceremony) { const { error: linkError } = await supabase!.from('expense_ceremonies').insert({ workspace_id: workspace.id, expense_id: created.id, ceremony_id: ceremony.id, allocation_percent: 100, created_by: userId }); if (linkError) throw linkError }
        } else {
          const received = entry.status === 'received'
          const values = { contributor_name: entry.contributor, pledged_minor: Math.round(entry.originalAmount * 100), received_minor: received ? Math.round(entry.originalAmount * 100) : 0, currency: entry.currency, exchange_rate: entry.exchangeRate, rate_source: entry.rateSource, rate_retrieved_at: new Date().toISOString(), ngn_received_minor: received ? Math.round(entry.amountNgn * 100) : 0, received_on: received ? entry.date : null, updated_by: userId }
          const result = operation.editing
            ? await supabase!.from('contributions').update(values).eq('workspace_id', workspace.id).eq('id', entry.id).select('id').single()
            : await supabase!.from('contributions').insert({ workspace_id: workspace.id, ...values, created_by: userId }).select('id').single()
          const { data: created, error } = result
          if (error) throw error
          if (operation.editing) {
            const { error: unlinkError } = await supabase!.from('contribution_allocations').delete().eq('workspace_id', workspace.id).eq('contribution_id', entry.id)
            if (unlinkError) throw unlinkError
          }
          if (ceremony) { const { error: linkError } = await supabase!.from('contribution_allocations').insert({ workspace_id: workspace.id, contribution_id: created.id, ceremony_id: ceremony.id, amount_minor: Math.round(entry.originalAmount * 100), created_by: userId, updated_by: userId }); if (linkError) throw linkError }
        }
      } else if (operation.kind === 'expense') {
        const status = operation.status === 'due' ? 'committed' : operation.status
        const { error } = await supabase!.from('expenses').update({ status, updated_by: userId }).eq('id', operation.id)
        if (error) throw error
      } else {
        const current = entries.find((entry) => entry.id === operation.id && entry.kind === 'contribution') as Contribution | undefined
        const received = operation.status === 'received'
        const { error } = await supabase!.from('contributions').update({ received_minor: received ? Math.round((current?.originalAmount ?? 0) * 100) : 0, ngn_received_minor: received ? Math.round((current?.amountNgn ?? 0) * 100) : 0, received_on: received ? new Date().toISOString().slice(0, 10) : null, updated_by: userId }).eq('id', operation.id)
        if (error) throw error
      }
    },
    onSuccess: (_data, operation) => {
      void queryClient.invalidateQueries({ queryKey: ['finance', workspace.id] })
      if (operation.type === 'entry') { setFormMode(null); setEditingEntry(null) }
    },
  })

  // oxlint-disable react/set-state-in-effect
  useEffect(() => {
    if (!financeQuery.data) return
    setAllocations(financeQuery.data.allocations.map((item) => ({ id: item.id, event: relationName(item.ceremonies) ?? item.category, amountNgn: item.planned_minor / 100 })))
    const remoteExpenses: Expense[] = financeQuery.data.expenses.map((entry) => ({ id: entry.id, kind: 'expense', description: entry.description, category: entry.category, event: relationName(entry.expense_ceremonies?.[0]?.ceremonies) ?? GENERAL_EVENT, status: entry.status === 'paid' ? 'paid' : entry.status === 'planned' ? 'planned' : 'due', date: entry.transaction_date, currency: entry.currency as Currency, originalAmount: entry.amount_minor / 100, exchangeRate: Number(entry.exchange_rate), amountNgn: entry.ngn_minor / 100, rateSource: entry.rate_source }))
    const remoteContributions: Contribution[] = financeQuery.data.contributions.map((entry) => ({ id: entry.id, kind: 'contribution', contributor: entry.contributor_name, event: relationName(entry.contribution_allocations?.[0]?.ceremonies) ?? GENERAL_EVENT, status: entry.received_minor > 0 ? 'received' : 'pledged', date: entry.received_on ?? '', currency: entry.currency as Currency, originalAmount: (entry.received_minor || entry.pledged_minor) / 100, exchangeRate: Number(entry.exchange_rate), amountNgn: entry.ngn_received_minor / 100, rateSource: entry.rate_source }))
    setEntries([...remoteExpenses, ...remoteContributions])
  }, [financeQuery.data])
  // oxlint-enable react/set-state-in-effect

  const eventNames = allocations.map(({ event }) => event)
  const allocated = allocations.reduce((total, item) => total + item.amountNgn, 0)
  const expenses = entries.filter((entry): entry is Expense => entry.kind === 'expense')
  const contributions = entries.filter((entry): entry is Contribution => entry.kind === 'contribution')
  const committed = expenses.filter(({ status }) => status !== 'planned').reduce((total, entry) => total + entry.amountNgn, 0)
  const paid = expenses.filter(({ status }) => status === 'paid').reduce((total, entry) => total + entry.amountNgn, 0)
  const received = contributions.filter(({ status }) => status === 'received').reduce((total, entry) => total + entry.amountNgn, 0)
  const filteredEntries = entries.filter((entry) => {
    const label = entry.kind === 'expense' ? `${entry.description} ${entry.category}` : entry.contributor
    return (!deferredQuery || `${label} ${entry.event} ${entry.currency}`.toLocaleLowerCase().includes(deferredQuery))
      && (kindFilter === 'all' || entry.kind === kindFilter)
      && (eventFilter === 'all' || entry.event === eventFilter)
      && (statusFilter === 'all' || entry.status === statusFilter)
  })

  function addAllocation(event: string, amountNgn: number) {
    if (isPreview) setAllocations((current) => [...current, { id: crypto.randomUUID(), event, amountNgn }])
    else financeMutation.mutate({ type: 'allocation', event, amount: amountNgn })
  }

  function updateAllocation(id: string, amountNgn: number) {
    setAllocations((current) => current.map((item) => item.id === id ? { ...item, amountNgn } : item))
  }

  function saveEntry(entry: LedgerEntry) {
    const editing = Boolean(editingEntry)
    if (isPreview) {
      setEntries((current) => editing ? current.map((item) => item.id === entry.id ? entry : item) : [entry, ...current])
      setFormMode(null)
      setEditingEntry(null)
    } else financeMutation.mutate({ type: 'entry', entry, editing })
  }

  function updateEntryStatus(id: string, status: EntryStatus) {
    setEntries((current) => current.map((entry) => {
      if (entry.id !== id) return entry
      if (entry.kind === 'expense' && (status === 'planned' || status === 'due' || status === 'paid')) return { ...entry, status }
      if (entry.kind === 'contribution' && (status === 'pledged' || status === 'received')) return { ...entry, status }
      return entry
    }))
    const entry = entries.find((item) => item.id === id)
    if (!isPreview && entry) financeMutation.mutate({ type: 'status', id, kind: entry.kind, status })
  }

  function openForm(mode: EntryKind) {
    setEditingEntry(null)
    setFormMode((current) => current === mode ? null : mode)
  }

  function editEntry(entry: LedgerEntry) {
    financeMutation.reset()
    setEditingEntry(entry)
    setFormMode(entry.kind)
  }

  return (
    <div className="page budget-page">
      <header className="page-header budget-header">
        <div>
          <p className="eyebrow">Finance / NGN reporting</p>
          <h1>Budget</h1>
          <p className="page-lead">Allocate by event, record every payment and contribution in its original currency, and review one combined naira position.</p>
        </div>
        <div className="header-actions">
          <button className="button secondary" type="button" onClick={() => openForm('contribution')}><ArrowDownLeft size={15} /> Add contribution</button>
          <button className="button primary" type="button" onClick={() => openForm('expense')}><Plus size={15} /> Add expense</button>
        </div>
      </header>

      <section className="budget-summary" aria-label="Budget summary in Nigerian naira">
        <SummaryCard label="Allocated" value={allocated} detail={`${allocations.length} event ${allocations.length === 1 ? 'budget' : 'budgets'}`} icon={<WalletCards size={15} />} />
        <SummaryCard label="Committed" value={committed} detail={`${formatNgn(paid)} paid`} icon={<ReceiptText size={15} />} />
        <SummaryCard label="Contributions" value={received} detail="Received funds" icon={<ArrowDownLeft size={15} />} />
        <SummaryCard label="Remaining" value={allocated - committed} detail="Allocation less commitments" icon={<CircleDollarSign size={15} />} />
      </section>

      {formMode === 'expense' && <ExpenseForm key={editingEntry?.id ?? 'new-expense'} events={eventNames} initial={editingEntry?.kind === 'expense' ? editingEntry : undefined} onSave={saveEntry} onClose={() => { setFormMode(null); setEditingEntry(null) }} />}
      {formMode === 'contribution' && <ContributionForm key={editingEntry?.id ?? 'new-contribution'} events={eventNames} initial={editingEntry?.kind === 'contribution' ? editingEntry : undefined} onSave={saveEntry} onClose={() => { setFormMode(null); setEditingEntry(null) }} />}
      {(financeQuery.error || financeMutation.error) && <p className="budget-data-error">{financeQuery.error?.message ?? financeMutation.error?.message}</p>}

      <section className="allocation-section" aria-labelledby="allocation-title">
        <div className="budget-section-heading">
          <div><p className="eyebrow">Event planning</p><h2 id="allocation-title">Allocations</h2></div>
          <span>All figures in NGN</span>
        </div>
        <AllocationEntry onAdd={addAllocation} existingEvents={eventNames} />
        {allocations.length > 0 ? (
          <div className="allocation-list">
            {allocations.map((allocation, index) => {
              const eventCommitted = expenses.filter(({ event }) => event === allocation.event).reduce((total, entry) => total + entry.amountNgn, 0)
              const percentage = allocation.amountNgn ? Math.min((eventCommitted / allocation.amountNgn) * 100, 100) : 0
              return (
                <article className="allocation-row" key={allocation.id}>
                  <span className="allocation-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="allocation-name"><strong>{allocation.event}</strong><span>{formatNgn(eventCommitted)} committed</span></div>
                  <div className="allocation-progress" aria-label={`${Math.round(percentage)} percent used`}><span style={{ width: `${percentage}%` }} /></div>
                   <label className="allocation-amount"><span>NGN</span><input aria-label={`${allocation.event} allocation`} type="number" min="0" step="1000" value={allocation.amountNgn || ''} onChange={(event) => updateAllocation(allocation.id, toAmount(event.target.value))} onBlur={() => { if (!isPreview) financeMutation.mutate({ type: 'allocation-save', id: allocation.id, amount: allocation.amountNgn }) }} /></label>
                    <button className="budget-icon-button" type="button" aria-label={`Remove ${allocation.event} allocation`} onClick={() => { setAllocations((current) => current.filter(({ id }) => id !== allocation.id)); if (!isPreview) financeMutation.mutate({ type: 'allocation-delete', id: allocation.id }) }}><Trash2 size={14} /></button>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="budget-empty compact"><WalletCards size={19} /><div><strong>No event allocations</strong><span>Add an event and its working budget to begin.</span></div></div>
        )}
      </section>

      <section className="ledger-section" aria-labelledby="ledger-title">
        <div className="budget-section-heading">
          <div><p className="eyebrow">Cash flow</p><h2 id="ledger-title">Combined ledger</h2></div>
          <span>{filteredEntries.length} of {entries.length} records</span>
        </div>
        <div className="budget-tools">
          <label className="budget-search"><Search size={15} /><span className="sr-only">Search ledger</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search description, contributor, event, or currency" /></label>
          <div className="budget-filters">
            <Filter value={kindFilter} label="Type" onChange={(value) => setKindFilter(value as typeof kindFilter)}><option value="all">All records</option><option value="expense">Expenses</option><option value="contribution">Contributions</option></Filter>
            <Filter value={eventFilter} label="Event" onChange={setEventFilter}><option value="all">All events</option><option value={GENERAL_EVENT}>{GENERAL_EVENT}</option>{eventNames.map((event) => <option key={event} value={event}>{event}</option>)}</Filter>
            <Filter value={statusFilter} label="Status" onChange={(value) => setStatusFilter(value as typeof statusFilter)}><option value="all">All statuses</option><option value="planned">Planned</option><option value="due">Due</option><option value="paid">Paid</option><option value="pledged">Pledged</option><option value="received">Received</option></Filter>
          </div>
        </div>

        {filteredEntries.length > 0 ? (
          <div className="ledger-list">
            <div className="ledger-head"><span>Record</span><span>Event</span><span>Source amount</span><span>NGN equivalent</span><span>Status</span><span className="sr-only">Actions</span></div>
            {filteredEntries.map((entry) => <LedgerRow entry={entry} key={entry.id} onEdit={editEntry} onStatusChange={updateEntryStatus} />)}
          </div>
        ) : (
          <div className="budget-empty"><ReceiptText size={22} /><h3>{entries.length ? 'No matching records' : 'Your ledger is empty'}</h3><p>{entries.length ? 'Adjust the search or filters to see more records.' : 'Add an expense or contribution. Every entry will report here in NGN.'}</p></div>
        )}
      </section>
    </div>
  )
}

function SummaryCard({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: React.ReactNode }) {
  return <article className="budget-summary-card"><div className="budget-summary-label"><span>{icon}</span>{label}</div><strong className={value < 0 ? 'negative' : ''}>{formatNgn(value)}</strong><small>{detail}</small></article>
}

function Filter({ value, label, onChange, children }: { value: string; label: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="budget-filter"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select><ChevronDown size={12} /></label>
}

function AllocationEntry({ onAdd, existingEvents }: { onAdd: (event: string, amount: number) => void; existingEvents: string[] }) {
  const [event, setEvent] = useState('')
  const [amount, setAmount] = useState('')
  const canAdd = Boolean(event.trim() && toAmount(amount) > 0 && !existingEvents.some((name) => name.toLocaleLowerCase() === event.trim().toLocaleLowerCase()))

  function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault()
    if (!canAdd) return
    onAdd(event.trim(), toAmount(amount))
    setEvent('')
    setAmount('')
  }

  return (
    <form className="allocation-entry" onSubmit={submit}>
      <label><span>Event name</span><input value={event} onChange={(change) => setEvent(change.target.value)} placeholder="Name this event budget" /></label>
      <label><span>Allocation</span><div className="money-input"><b>NGN</b><input type="number" min="0" step="1000" value={amount} onChange={(change) => setAmount(change.target.value)} placeholder="0" /></div></label>
      <button className="button secondary" type="submit" disabled={!canAdd}><Plus size={14} /> Add allocation</button>
    </form>
  )
}

function ExpenseForm({ events, initial, onSave, onClose }: { events: string[]; initial?: Expense; onSave: (entry: Expense) => void; onClose: () => void }) {
  const { workspace, isPreview } = useWorkspace()
  const [description, setDescription] = useState(initial?.description ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [event, setEvent] = useState(initial?.event ?? GENERAL_EVENT)
  const [status, setStatus] = useState<ExpenseStatus>(initial?.status ?? 'planned')
  const [date, setDate] = useState(initial?.date ?? '')
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? 'NGN')
  const [amount, setAmount] = useState(initial ? String(initial.originalAmount) : '')
  const [rate, setRate] = useState(initial ? String(initial.exchangeRate) : '1')
  const [rateSource, setRateSource] = useState(initial?.rateSource ?? 'native')
  const amountNgn = toAmount(amount) * (currency === 'NGN' ? 1 : toAmount(rate))
  const canSubmit = Boolean(description.trim() && category.trim() && date && toAmount(amount) > 0 && amountNgn > 0)

  function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault()
    if (!canSubmit) return
    onSave({ id: initial?.id ?? crypto.randomUUID(), kind: 'expense', description: description.trim(), category: category.trim(), event, status, date, currency, originalAmount: toAmount(amount), exchangeRate: currency === 'NGN' ? 1 : toAmount(rate), amountNgn, rateSource })
  }

  async function lookup(nextCurrency: Currency, nextDate = date) { setCurrency(nextCurrency); if (nextCurrency === 'NGN') { setRate('1'); setRateSource('native'); return } if (isPreview || !nextDate) { setRateSource('manual'); return } try { const result = await fetchNgnRate(workspace.id, nextCurrency, nextDate); setRate(String(result.rate)); setRateSource(result.source) } catch { setRateSource('manual') } }

  return <MoneyForm title={initial ? 'Edit expense' : 'Add an expense'} eyebrow={initial ? 'Update outgoing record' : 'New outgoing record'} submitLabel={initial ? 'Save changes' : 'Add expense'} canSubmit={canSubmit} currency={currency} amount={amount} rate={rate} rateSource={rateSource} amountNgn={amountNgn} onCurrency={(value) => void lookup(value)} onAmount={setAmount} onRate={(value) => { setRate(value); setRateSource('manual') }} onClose={onClose} onSubmit={submit}>
    <label className="budget-field field-span-2"><span>Description</span><input autoFocus value={description} onChange={(change) => setDescription(change.target.value)} placeholder="What is this expense for?" /></label>
    <label className="budget-field"><span>Category</span><input value={category} onChange={(change) => setCategory(change.target.value)} placeholder="e.g. Venue or attire" /></label>
    <EventField value={event} events={events} onChange={setEvent} />
    <label className="budget-field"><span>Payment status</span><select value={status} onChange={(change) => setStatus(change.target.value as ExpenseStatus)}><option value="planned">Planned</option><option value="due">Due</option><option value="paid">Paid</option></select></label>
    <label className="budget-field"><span>Transaction date</span><input type="date" required value={date} onChange={(change) => { setDate(change.target.value); void lookup(currency, change.target.value) }} /></label>
  </MoneyForm>
}

function ContributionForm({ events, initial, onSave, onClose }: { events: string[]; initial?: Contribution; onSave: (entry: Contribution) => void; onClose: () => void }) {
  const { workspace, isPreview } = useWorkspace()
  const [contributor, setContributor] = useState(initial?.contributor ?? '')
  const [event, setEvent] = useState(initial?.event ?? GENERAL_EVENT)
  const [status, setStatus] = useState<ContributionStatus>(initial?.status ?? 'pledged')
  const [date, setDate] = useState(initial?.date ?? '')
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? 'NGN')
  const [amount, setAmount] = useState(initial ? String(initial.originalAmount) : '')
  const [rate, setRate] = useState(initial ? String(initial.exchangeRate) : '1')
  const [rateSource, setRateSource] = useState(initial?.rateSource ?? 'native')
  const amountNgn = toAmount(amount) * (currency === 'NGN' ? 1 : toAmount(rate))
  const canSubmit = Boolean(contributor.trim() && toAmount(amount) > 0 && amountNgn > 0 && (status !== 'received' || date))

  function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault()
    if (!canSubmit) return
    onSave({ id: initial?.id ?? crypto.randomUUID(), kind: 'contribution', contributor: contributor.trim(), event, status, date, currency, originalAmount: toAmount(amount), exchangeRate: currency === 'NGN' ? 1 : toAmount(rate), amountNgn, rateSource })
  }

  async function lookup(nextCurrency: Currency, nextDate = date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date())) { setCurrency(nextCurrency); if (nextCurrency === 'NGN') { setRate('1'); setRateSource('native'); return } if (isPreview) { setRateSource('manual'); return } try { const result = await fetchNgnRate(workspace.id, nextCurrency, nextDate); setRate(String(result.rate)); setRateSource(result.source) } catch { setRateSource('manual') } }

  return <MoneyForm title={initial ? 'Edit contribution' : 'Add a contribution'} eyebrow={initial ? 'Update incoming record' : 'New incoming record'} submitLabel={initial ? 'Save changes' : 'Add contribution'} canSubmit={canSubmit} currency={currency} amount={amount} rate={rate} rateSource={rateSource} amountNgn={amountNgn} onCurrency={(value) => void lookup(value)} onAmount={setAmount} onRate={(value) => { setRate(value); setRateSource('manual') }} onClose={onClose} onSubmit={submit}>
    <label className="budget-field field-span-2"><span>Contributor or source</span><input autoFocus value={contributor} onChange={(change) => setContributor(change.target.value)} placeholder="Name or funding source" /></label>
    <EventField value={event} events={events} onChange={setEvent} />
    <label className="budget-field"><span>Contribution status</span><select value={status} onChange={(change) => setStatus(change.target.value as ContributionStatus)}><option value="pledged">Pledged</option><option value="received">Received</option></select></label>
    <label className="budget-field"><span>Received date <small>optional</small></span><input type="date" value={date} onChange={(change) => { setDate(change.target.value); void lookup(currency, change.target.value) }} /></label>
  </MoneyForm>
}

function EventField({ value, events, onChange }: { value: string; events: string[]; onChange: (value: string) => void }) {
  return <label className="budget-field"><span>Event</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value={GENERAL_EVENT}>{GENERAL_EVENT}</option>{events.map((event) => <option value={event} key={event}>{event}</option>)}</select></label>
}

interface MoneyFormProps {
  title: string
  eyebrow: string
  submitLabel: string
  canSubmit: boolean
  currency: Currency
  amount: string
  rate: string
  rateSource: string
  amountNgn: number
  onCurrency: (currency: Currency) => void
  onAmount: (amount: string) => void
  onRate: (rate: string) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children: React.ReactNode
}

function MoneyForm({ title, eyebrow, submitLabel, canSubmit, currency, amount, rate, rateSource, amountNgn, onCurrency, onAmount, onRate, onClose, onSubmit, children }: MoneyFormProps) {
  function changeCurrency(next: Currency) {
    onCurrency(next)
  }

  return (
    <section className="budget-entry-panel" aria-labelledby="money-form-title">
      <div className="budget-entry-intro"><div><p className="eyebrow">{eyebrow}</p><h2 id="money-form-title">{title}</h2><p>Source values remain visible; reporting uses the NGN equivalent.</p></div><button className="budget-icon-button" type="button" onClick={onClose} aria-label="Close form"><X size={17} /></button></div>
      <form onSubmit={onSubmit}>
        <div className="budget-form-grid">{children}
          <label className="budget-field"><span>Original currency</span><select value={currency} onChange={(event) => changeCurrency(event.target.value as Currency)}>{CURRENCIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="budget-field"><span>Original amount</span><input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(event) => onAmount(event.target.value)} placeholder="0.00" /></label>
          <label className="budget-field"><span>NGN per {currency}</span><input type="number" min="0" step="0.01" inputMode="decimal" disabled={currency === 'NGN'} value={currency === 'NGN' ? '1' : rate} onChange={(event) => onRate(event.target.value)} /></label>
          <div className="ngn-preview"><span>NGN equivalent</span><strong>{formatNgn(amountNgn)}</strong><small>{currency === 'NGN' ? 'No conversion required' : `${currency} 1 × NGN ${numberFormatter.format(toAmount(rate))} / ${rateSource}`}</small></div>
        </div>
        <div className="budget-form-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={!canSubmit}>{submitLabel}</button></div>
      </form>
    </section>
  )
}

function LedgerRow({ entry, onEdit, onStatusChange }: { entry: LedgerEntry; onEdit: (entry: LedgerEntry) => void; onStatusChange: (id: string, status: EntryStatus) => void }) {
  const title = entry.kind === 'expense' ? entry.description : entry.contributor
  const subtitle = entry.kind === 'expense' ? entry.category : 'Contribution'
  return (
    <article className="ledger-row">
      <div className="ledger-record"><span className={`ledger-kind ${entry.kind}`}>{entry.kind === 'expense' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}</span><div><strong>{title}</strong><small>{subtitle}{entry.date ? ` · ${entry.date}` : ''}</small></div></div>
      <span className="ledger-event">{entry.event}</span>
      <div className="ledger-source"><strong>{formatOriginal(entry)}</strong><small>Rate: NGN {numberFormatter.format(entry.exchangeRate)}</small></div>
      <strong className={`ledger-ngn ${entry.kind}`}>{entry.kind === 'expense' ? '−' : '+'}{formatNgn(entry.amountNgn)}</strong>
      <label className={`payment-status status-${entry.status}`}><i /><span className="sr-only">Update status for {title}</span><select value={entry.status} onChange={(event) => onStatusChange(entry.id, event.target.value as EntryStatus)}>{entry.kind === 'expense' ? <><option value="planned">Planned</option><option value="due">Due</option><option value="paid">Paid</option></> : <><option value="pledged">Pledged</option><option value="received">Received</option></>}</select></label>
      <button className="budget-icon-button ledger-edit" type="button" aria-label={`Edit ${title}`} onClick={() => onEdit(entry)}><Pencil size={13} /></button>
    </article>
  )
}
