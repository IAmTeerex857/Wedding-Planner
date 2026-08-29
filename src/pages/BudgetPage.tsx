import { useDeferredValue, useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleDollarSign,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  WalletCards,
  X,
} from '../components/KoboyoIcon'
import { ConfirmDialog } from '../components/ConfirmDialog'
import './budget.css'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import { fetchNgnRate } from '../lib/exchange-rates'
import { pillTone } from '../lib/pills'

type Currency = 'NGN' | 'USD' | 'GBP' | 'EUR'
type ExpenseStatus = 'planned' | 'due' | 'paid'
type ContributionStatus = 'pledged' | 'partial' | 'received'
type EntryStatus = ExpenseStatus | ContributionStatus
type EntryKind = 'expense' | 'contribution'

interface Allocation {
  id: string
  name: string
  ceremonyId: string
  ceremony: string
  amountNgn: number
}

type Ceremony = { id: string; name: string }

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
  allocationId: string
  allocation: string
  ceremonyId: string
  ceremony: string
  status: ExpenseStatus
  date: string
}

interface Contribution extends MoneySource {
  id: string
  kind: 'contribution'
  contributor: string
  ceremonyId: string
  ceremony: string
  receivedPercent: number
  receivedNgn: number
  status: ContributionStatus
  date: string
}

type LedgerEntry = Expense | Contribution
type FormMode = EntryKind | null

type FinanceOperation =
  | { type: 'allocation'; name: string; amount: number; ceremonyId: string }
  | { type: 'allocation-save'; id: string; amount: number }
  | { type: 'allocation-delete'; id: string }
  | { type: 'entry'; entry: LedgerEntry; editing: boolean }
  | { type: 'status'; id: string; kind: EntryKind; status: EntryStatus }
  | { type: 'entry-delete'; id: string; kind: EntryKind }

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

function relationCeremony(value: unknown): Ceremony | null {
  const relation = Array.isArray(value) ? value[0] : value
  if (!relation || typeof relation !== 'object' || !('id' in relation) || !('name' in relation)) return null
  return { id: String(relation.id), name: String(relation.name).replace(/ Wedding$/i, '') }
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
  const [allocationFilter, setAllocationFilter] = useState('all')
  const [ceremonyFilter, setCeremonyFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | EntryStatus>('all')
  const [pendingDelete, setPendingDelete] = useState<{ type: 'allocation' | EntryKind; id: string; label: string } | null>(null)
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())
  const financeQuery = useQuery({
    queryKey: ['finance', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const [{ data: budget, error: budgetError }, { data: ceremonies, error: ceremonyError }, { data: expenses, error: expenseError }, { data: contributions, error: contributionError }] = await Promise.all([
        supabase!.from('budgets').select('id').eq('workspace_id', workspace.id).is('deleted_at', null).maybeSingle(),
        supabase!.from('ceremonies').select('id,name').eq('workspace_id', workspace.id).is('deleted_at', null).order('kind'),
        supabase!.from('expenses').select('id,budget_allocation_id,description,category,status,amount_minor,currency,transaction_date,exchange_rate,rate_source,ngn_minor,expense_ceremonies(ceremonies(id,name))').eq('workspace_id', workspace.id).is('deleted_at', null).order('transaction_date', { ascending: false }),
        supabase!.from('contributions').select('id,contributor_name,pledged_minor,received_minor,currency,exchange_rate,rate_source,ngn_received_minor,received_on,contribution_allocations(ceremonies(id,name))').eq('workspace_id', workspace.id).is('deleted_at', null).order('created_at', { ascending: false }),
      ])
      if (budgetError || ceremonyError || expenseError || contributionError) throw budgetError ?? ceremonyError ?? expenseError ?? contributionError
      let budgetAllocations: Array<{ id: string; category: string; planned_minor: number; ceremony_id: string | null; ceremonies: Array<{ id: string; name: string }> }> = []
      if (budget) {
        const { data, error } = await supabase!.from('budget_allocations').select('id,category,planned_minor,ceremony_id,ceremonies(id,name)').eq('budget_id', budget.id).is('deleted_at', null)
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
        const { error } = await supabase!.from('budget_allocations').insert({ workspace_id: workspace.id, budget_id: budgetId, ceremony_id: operation.ceremonyId || null, category: operation.name, planned_minor: Math.round(operation.amount * 100), created_by: userId, updated_by: userId })
        if (error) throw error
      } else if (operation.type === 'allocation-save') {
        const { error } = await supabase!.from('budget_allocations').update({ planned_minor: Math.round(operation.amount * 100), updated_by: userId }).eq('workspace_id', workspace.id).eq('id', operation.id)
        if (error) throw error
      } else if (operation.type === 'allocation-delete') {
        const { error } = await supabase!.from('budget_allocations').update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq('workspace_id', workspace.id).eq('id', operation.id)
        if (error) throw error
      } else if (operation.type === 'entry') {
        const entry = operation.entry
        if (entry.kind === 'expense') {
          const values = { budget_allocation_id: entry.allocationId || null, description: entry.description, category: entry.category, status: entry.status === 'due' ? 'committed' : entry.status, amount_minor: Math.round(entry.originalAmount * 100), currency: entry.currency, transaction_date: entry.date, exchange_rate: entry.exchangeRate, rate_source: entry.rateSource, rate_retrieved_at: new Date().toISOString(), ngn_minor: Math.round(entry.amountNgn * 100), updated_by: userId }
          const result = operation.editing
            ? await supabase!.from('expenses').update(values).eq('workspace_id', workspace.id).eq('id', entry.id).select('id').single()
            : await supabase!.from('expenses').insert({ workspace_id: workspace.id, ...values, created_by: userId }).select('id').single()
          const { data: created, error } = result
          if (error) throw error
          if (operation.editing) {
            const { error: unlinkError } = await supabase!.from('expense_ceremonies').delete().eq('workspace_id', workspace.id).eq('expense_id', entry.id)
            if (unlinkError) throw unlinkError
          }
          if (entry.ceremonyId) { const { error: linkError } = await supabase!.from('expense_ceremonies').insert({ workspace_id: workspace.id, expense_id: created.id, ceremony_id: entry.ceremonyId, allocation_percent: 100, created_by: userId }); if (linkError) throw linkError }
        } else {
          const hasReceived = entry.receivedPercent > 0
          const values = { contributor_name: entry.contributor, pledged_minor: Math.round(entry.originalAmount * 100), received_minor: Math.round(entry.originalAmount * 100 * entry.receivedPercent / 100), currency: entry.currency, exchange_rate: entry.exchangeRate, rate_source: entry.rateSource, rate_retrieved_at: new Date().toISOString(), ngn_received_minor: Math.round(entry.receivedNgn * 100), received_on: hasReceived ? entry.date : null, updated_by: userId }
          const result = operation.editing
            ? await supabase!.from('contributions').update(values).eq('workspace_id', workspace.id).eq('id', entry.id).select('id').single()
            : await supabase!.from('contributions').insert({ workspace_id: workspace.id, ...values, created_by: userId }).select('id').single()
          const { data: created, error } = result
          if (error) throw error
          if (operation.editing) {
            const { error: unlinkError } = await supabase!.from('contribution_allocations').delete().eq('workspace_id', workspace.id).eq('contribution_id', entry.id)
            if (unlinkError) throw unlinkError
          }
          if (entry.ceremonyId) { const { error: linkError } = await supabase!.from('contribution_allocations').insert({ workspace_id: workspace.id, contribution_id: created.id, ceremony_id: entry.ceremonyId, amount_minor: Math.round(entry.originalAmount * 100), created_by: userId, updated_by: userId }); if (linkError) throw linkError }
        }
      } else if (operation.type === 'status' && operation.kind === 'expense') {
        const status = operation.status === 'due' ? 'committed' : operation.status
        const { error } = await supabase!.from('expenses').update({ status, updated_by: userId }).eq('id', operation.id)
        if (error) throw error
      } else if (operation.type === 'status') {
        const current = entries.find((entry) => entry.id === operation.id && entry.kind === 'contribution') as Contribution | undefined
        const received = operation.status === 'received'
        const { error } = await supabase!.from('contributions').update({ received_minor: received ? Math.round((current?.originalAmount ?? 0) * 100) : 0, ngn_received_minor: received ? Math.round((current?.amountNgn ?? 0) * 100) : 0, received_on: received ? new Date().toISOString().slice(0, 10) : null, updated_by: userId }).eq('id', operation.id)
        if (error) throw error
      } else {
        const table = operation.kind === 'expense' ? 'expenses' : 'contributions'
        const { error } = await supabase!.from(table).update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq('workspace_id', workspace.id).eq('id', operation.id)
        if (error) throw error
      }
    },
    onSuccess: (_data, operation) => {
      void queryClient.invalidateQueries({ queryKey: ['finance', workspace.id] })
      if (operation.type === 'entry') { setFormMode(null); setEditingEntry(null) }
      if (operation.type === 'entry-delete') void queryClient.invalidateQueries({ queryKey: ['recycle-bin', workspace.id] })
    },
  })

  // oxlint-disable react/set-state-in-effect
  useEffect(() => {
    if (!financeQuery.data) return
    const mappedAllocations = financeQuery.data.allocations.map((item) => { const ceremony = relationCeremony(item.ceremonies); return { id: item.id, name: item.category === 'Ceremony allocation' ? `${ceremony?.name ?? 'General'} budget` : item.category, ceremonyId: item.ceremony_id ?? '', ceremony: ceremony?.name ?? GENERAL_EVENT, amountNgn: item.planned_minor / 100 } })
    setAllocations(mappedAllocations)
    const remoteExpenses: Expense[] = financeQuery.data.expenses.map((entry) => { const ceremony = relationCeremony(entry.expense_ceremonies?.[0]?.ceremonies); const allocation = mappedAllocations.find((item) => item.id === entry.budget_allocation_id); return { id: entry.id, kind: 'expense', description: entry.description, category: entry.category, allocationId: entry.budget_allocation_id ?? '', allocation: allocation?.name ?? 'Unallocated', ceremonyId: ceremony?.id ?? '', ceremony: ceremony?.name ?? GENERAL_EVENT, status: entry.status === 'paid' ? 'paid' : entry.status === 'planned' || entry.status === 'cancelled' ? 'planned' : 'due', date: entry.transaction_date, currency: entry.currency as Currency, originalAmount: entry.amount_minor / 100, exchangeRate: Number(entry.exchange_rate), amountNgn: entry.ngn_minor / 100, rateSource: entry.rate_source } })
    const remoteContributions: Contribution[] = financeQuery.data.contributions.map((entry) => { const ceremony = relationCeremony(entry.contribution_allocations?.[0]?.ceremonies); const originalAmount = entry.pledged_minor / 100; const receivedAmount = entry.received_minor / 100; const receivedPercent = originalAmount ? Math.min(receivedAmount / originalAmount * 100, 100) : 0; const exchangeRate = Number(entry.exchange_rate); return { id: entry.id, kind: 'contribution', contributor: entry.contributor_name, ceremonyId: ceremony?.id ?? '', ceremony: ceremony?.name ?? GENERAL_EVENT, receivedPercent, receivedNgn: entry.ngn_received_minor / 100, status: receivedPercent >= 100 ? 'received' : receivedPercent > 0 ? 'partial' : 'pledged', date: entry.received_on ?? '', currency: entry.currency as Currency, originalAmount, exchangeRate, amountNgn: originalAmount * exchangeRate, rateSource: entry.rate_source } })
    setEntries([...remoteExpenses, ...remoteContributions])
  }, [financeQuery.data])
  // oxlint-enable react/set-state-in-effect

  const ceremonies = (financeQuery.data?.ceremonies ?? []).map((ceremony) => ({ id: ceremony.id, name: ceremony.name.replace(/ Wedding$/i, '') }))
  const matchesCeremony = (ceremonyId: string) => ceremonyFilter === 'all' || (ceremonyFilter === 'general' ? !ceremonyId : ceremonyId === ceremonyFilter)
  const visibleAllocations = allocations.filter((allocation) => matchesCeremony(allocation.ceremonyId))
  const visibleEntries = entries.filter((entry) => matchesCeremony(entry.ceremonyId))
  const allocated = visibleAllocations.reduce((total, item) => total + item.amountNgn, 0)
  const expenses = entries.filter((entry): entry is Expense => entry.kind === 'expense')
  const contributions = entries.filter((entry): entry is Contribution => entry.kind === 'contribution')
  const visibleExpenses = expenses.filter((entry) => matchesCeremony(entry.ceremonyId))
  const visibleContributions = contributions.filter((entry) => matchesCeremony(entry.ceremonyId))
  const committed = visibleExpenses.filter(({ status }) => status !== 'planned').reduce((total, entry) => total + entry.amountNgn, 0)
  const paid = visibleExpenses.filter(({ status }) => status === 'paid').reduce((total, entry) => total + entry.amountNgn, 0)
  const received = visibleContributions.reduce((total, entry) => total + entry.receivedNgn, 0)
  const filteredEntries = visibleEntries.filter((entry) => {
    const label = entry.kind === 'expense' ? `${entry.description} ${entry.category}` : entry.contributor
    return (!deferredQuery || `${label} ${entry.kind === 'expense' ? entry.allocation : ''} ${entry.ceremony} ${entry.currency}`.toLocaleLowerCase().includes(deferredQuery))
      && (kindFilter === 'all' || entry.kind === kindFilter)
      && (allocationFilter === 'all' || (entry.kind === 'expense' && entry.allocationId === allocationFilter))
      && (statusFilter === 'all' || entry.status === statusFilter)
  })

  function addAllocation(name: string, amountNgn: number, ceremonyId: string) {
    const ceremony = ceremonies.find((item) => item.id === ceremonyId)
    if (isPreview) setAllocations((current) => [...current, { id: crypto.randomUUID(), name, ceremonyId, ceremony: ceremony?.name ?? GENERAL_EVENT, amountNgn }])
    else financeMutation.mutate({ type: 'allocation', name, amount: amountNgn, ceremonyId })
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

  function confirmDelete() {
    if (!pendingDelete) return
    if (pendingDelete.type === 'allocation') {
      setAllocations((current) => current.filter(({ id }) => id !== pendingDelete.id))
      if (!isPreview) financeMutation.mutate({ type: 'allocation-delete', id: pendingDelete.id })
    } else {
      setEntries((current) => current.filter(({ id }) => id !== pendingDelete.id))
      if (!isPreview) financeMutation.mutate({ type: 'entry-delete', id: pendingDelete.id, kind: pendingDelete.type })
    }
    setPendingDelete(null)
  }

  return (
    <div className="page budget-page ui-page">
      <header className="page-header budget-header">
        <div>
          <p className="eyebrow">Finance / NGN reporting</p>
          <h1>Budget</h1>
          <p className="page-lead">Create spending allocations, connect them to ceremonies, and record every payment and contribution in its original currency.</p>
        </div>
        <div className="header-actions">
          <label className="page-ceremony-filter"><span>Ceremony</span><select value={ceremonyFilter} onChange={(event) => setCeremonyFilter(event.target.value)}><option value="all">All ceremonies</option><option value="general">General / shared</option>{ceremonies.map((ceremony) => <option value={ceremony.id} key={ceremony.id}>{ceremony.name}</option>)}</select></label>
          <button className="button secondary" type="button" onClick={() => openForm('contribution')}><ArrowDownLeft size={15} /> Add contribution</button>
          <button className="button primary" type="button" onClick={() => openForm('expense')}><Plus size={15} /> Add expense</button>
        </div>
      </header>

      <section className="budget-summary" aria-label="Budget summary in Nigerian naira">
        <SummaryCard label="Allocated" value={allocated} detail={`${visibleAllocations.length} ${visibleAllocations.length === 1 ? 'allocation' : 'allocations'}`} icon={<WalletCards size={15} />} />
        <SummaryCard label="Committed" value={committed} detail={`${formatNgn(paid)} paid`} icon={<ReceiptText size={15} />} />
        <SummaryCard label="Contributions" value={received} detail="Received funds" icon={<ArrowDownLeft size={15} />} />
        <SummaryCard label="Remaining" value={allocated - committed} detail="Allocation less commitments" icon={<CircleDollarSign size={15} />} />
      </section>

      {formMode === 'expense' && <ExpenseForm key={editingEntry?.id ?? 'new-expense'} allocations={allocations} ceremonies={ceremonies} initial={editingEntry?.kind === 'expense' ? editingEntry : undefined} onSave={saveEntry} onClose={() => { setFormMode(null); setEditingEntry(null) }} />}
      {formMode === 'contribution' && <ContributionForm key={editingEntry?.id ?? 'new-contribution'} ceremonies={ceremonies} initial={editingEntry?.kind === 'contribution' ? editingEntry : undefined} onSave={saveEntry} onClose={() => { setFormMode(null); setEditingEntry(null) }} />}
      {(financeQuery.error || financeMutation.error) && <p className="budget-data-error">{financeQuery.error?.message ?? financeMutation.error?.message}</p>}

      <section className="allocation-section" aria-labelledby="allocation-title">
        <div className="budget-section-heading">
          <div><p className="eyebrow">Spending plan</p><h2 id="allocation-title">Allocations</h2></div>
          <span>All figures in NGN</span>
        </div>
        <AllocationEntry onAdd={addAllocation} allocations={allocations} ceremonies={ceremonies} />
        {visibleAllocations.length > 0 ? (
          <div className="allocation-list">
            {visibleAllocations.map((allocation, index) => {
              const allocationCommitted = visibleExpenses.filter((expense) => expense.allocationId === allocation.id && expense.status !== 'planned').reduce((total, entry) => total + entry.amountNgn, 0)
              const percentage = allocation.amountNgn ? (allocationCommitted / allocation.amountNgn) * 100 : 0
              return (
                <article className="allocation-row" key={allocation.id}>
                  <span className="allocation-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="allocation-name"><strong>{allocation.name}</strong><span>{allocation.ceremony} / {formatNgn(allocationCommitted)} committed</span></div>
                  <div className="allocation-progress" aria-label={`${Math.round(percentage)} percent used`}><span style={{ width: `${Math.min(percentage, 100)}%` }} /></div>
                   <label className="allocation-amount"><span>NGN</span><input aria-label={`${allocation.name} allocation`} type="number" min="0" step="1000" value={allocation.amountNgn || ''} onChange={(event) => updateAllocation(allocation.id, toAmount(event.target.value))} onBlur={() => { if (!isPreview) financeMutation.mutate({ type: 'allocation-save', id: allocation.id, amount: allocation.amountNgn }) }} /></label>
                    <button className="budget-icon-button" type="button" aria-label={`Remove ${allocation.name} allocation`} onClick={() => setPendingDelete({ type: 'allocation', id: allocation.id, label: allocation.name })}><Trash2 size={14} /></button>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="budget-empty compact"><WalletCards size={19} /><div><strong>No allocations found</strong><span>Add a spending allocation or change the ceremony filter.</span></div></div>
        )}
      </section>

      <section className="ledger-section" aria-labelledby="ledger-title">
        <div className="budget-section-heading">
          <div><p className="eyebrow">Cash flow</p><h2 id="ledger-title">Combined ledger</h2></div>
          <span>{filteredEntries.length} of {entries.length} records</span>
        </div>
        <div className="budget-tools">
          <label className="budget-search"><Search size={15} /><span className="sr-only">Search ledger</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search record, allocation, ceremony, or currency" /></label>
          <div className="budget-filters">
            <Filter value={kindFilter} label="Type" onChange={(value) => setKindFilter(value as typeof kindFilter)}><option value="all">All records</option><option value="expense">Expenses</option><option value="contribution">Contributions</option></Filter>
            <Filter value={allocationFilter} label="Allocation" onChange={setAllocationFilter}><option value="all">All allocations</option>{allocations.map((allocation) => <option key={allocation.id} value={allocation.id}>{allocation.name}</option>)}</Filter>
            <Filter value={statusFilter} label="Status" onChange={(value) => setStatusFilter(value as typeof statusFilter)}><option value="all">All statuses</option><option value="planned">Planned</option><option value="due">Due</option><option value="paid">Paid</option><option value="pledged">Pledged</option><option value="partial">Partially received</option><option value="received">Received</option></Filter>
          </div>
        </div>

        {filteredEntries.length > 0 ? (
          <div className="ledger-list">
            <div className="ledger-head"><span>Record</span><span>Allocation / ceremony</span><span>Source amount</span><span>NGN equivalent</span><span>Status</span><span>Actions</span></div>
            {filteredEntries.map((entry) => <LedgerRow entry={entry} key={entry.id} onEdit={editEntry} onDelete={(item) => setPendingDelete({ type: item.kind, id: item.id, label: item.kind === 'expense' ? item.description : item.contributor })} onStatusChange={updateEntryStatus} />)}
          </div>
        ) : (
          <div className="budget-empty"><ReceiptText size={22} /><h3>{entries.length ? 'No matching records' : 'Your ledger is empty'}</h3><p>{entries.length ? 'Adjust the search or filters to see more records.' : 'Add an expense or contribution. Every entry will report here in NGN.'}</p></div>
        )}
      </section>
      {pendingDelete && <ConfirmDialog title={`Delete ${pendingDelete.label}?`} description={pendingDelete.type === 'allocation' ? 'This allocation will be removed from the budget. Expenses linked to it will remain in the ledger as unallocated.' : 'This ledger entry will move to the recycle bin and can be restored later.'} onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />}
    </div>
  )
}

function SummaryCard({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: React.ReactNode }) {
  return <article className="budget-summary-card"><div className="budget-summary-label"><span>{icon}</span>{label}</div><strong className={value < 0 ? 'negative' : ''}>{formatNgn(value)}</strong><small>{detail}</small></article>
}

function Filter({ value, label, onChange, children }: { value: string; label: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="budget-filter"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>
}

function AllocationEntry({ onAdd, allocations, ceremonies }: { onAdd: (name: string, amount: number, ceremonyId: string) => void; allocations: Allocation[]; ceremonies: Ceremony[] }) {
  const [name, setName] = useState('')
  const [ceremonyId, setCeremonyId] = useState('')
  const [amount, setAmount] = useState('')
  const canAdd = Boolean(name.trim() && toAmount(amount) > 0 && !allocations.some((allocation) => allocation.ceremonyId === ceremonyId && allocation.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase()))

  function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault()
    if (!canAdd) return
    onAdd(name.trim(), toAmount(amount), ceremonyId)
    setName('')
    setAmount('')
  }

  return (
    <form className="allocation-entry" onSubmit={submit}>
      <label><span>Allocation name</span><input value={name} onChange={(change) => setName(change.target.value)} placeholder="e.g. Venue, attire or transport" /></label>
      <label><span>Ceremony</span><select value={ceremonyId} onChange={(change) => setCeremonyId(change.target.value)}><option value="">General / shared</option>{ceremonies.map((ceremony) => <option value={ceremony.id} key={ceremony.id}>{ceremony.name}</option>)}</select></label>
      <label><span>Allocation</span><div className="money-input"><b>NGN</b><input type="number" min="0" step="1000" value={amount} onChange={(change) => setAmount(change.target.value)} placeholder="0" /></div></label>
      <button className="button secondary" type="submit" disabled={!canAdd}><Plus size={14} /> Add allocation</button>
    </form>
  )
}

function ExpenseForm({ allocations, ceremonies, initial, onSave, onClose }: { allocations: Allocation[]; ceremonies: Ceremony[]; initial?: Expense; onSave: (entry: Expense) => void; onClose: () => void }) {
  const { workspace, isPreview } = useWorkspace()
  const [description, setDescription] = useState(initial?.description ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [allocationId, setAllocationId] = useState(initial?.allocationId ?? '')
  const [ceremonyId, setCeremonyId] = useState(initial?.ceremonyId ?? '')
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
    const allocation = allocations.find((item) => item.id === allocationId)
    const ceremony = ceremonies.find((item) => item.id === ceremonyId)
    onSave({ id: initial?.id ?? crypto.randomUUID(), kind: 'expense', description: description.trim(), category: category.trim(), allocationId, allocation: allocation?.name ?? 'Unallocated', ceremonyId, ceremony: ceremony?.name ?? GENERAL_EVENT, status, date, currency, originalAmount: toAmount(amount), exchangeRate: currency === 'NGN' ? 1 : toAmount(rate), amountNgn, rateSource })
  }

  async function lookup(nextCurrency: Currency, nextDate = date) { setCurrency(nextCurrency); if (nextCurrency === 'NGN') { setRate('1'); setRateSource('native'); return } if (isPreview || !nextDate) { setRateSource('manual'); return } try { const result = await fetchNgnRate(workspace.id, nextCurrency, nextDate); setRate(String(result.rate)); setRateSource(result.source) } catch { setRateSource('manual') } }

  return <MoneyForm title={initial ? 'Edit expense' : 'Add an expense'} eyebrow={initial ? 'Update outgoing record' : 'New outgoing record'} submitLabel={initial ? 'Save changes' : 'Add expense'} canSubmit={canSubmit} currency={currency} amount={amount} rate={rate} rateSource={rateSource} amountNgn={amountNgn} onCurrency={(value) => void lookup(value)} onAmount={setAmount} onRate={(value) => { setRate(value); setRateSource('manual') }} onClose={onClose} onSubmit={submit}>
    <label className="budget-field field-span-2"><span>Description</span><input autoFocus value={description} onChange={(change) => setDescription(change.target.value)} placeholder="What is this expense for?" /></label>
    <label className="budget-field"><span>Category</span><input value={category} onChange={(change) => setCategory(change.target.value)} placeholder="e.g. Venue or attire" /></label>
    <AllocationField value={allocationId} allocations={allocations} onChange={setAllocationId} />
    <CeremonyField value={ceremonyId} ceremonies={ceremonies} onChange={setCeremonyId} />
    <label className="budget-field"><span>Payment status</span><select value={status} onChange={(change) => setStatus(change.target.value as ExpenseStatus)}><option value="planned">Planned</option><option value="due">Due</option><option value="paid">Paid</option></select></label>
    <label className="budget-field"><span>Transaction date</span><input type="date" required value={date} onChange={(change) => { setDate(change.target.value); void lookup(currency, change.target.value) }} /></label>
  </MoneyForm>
}

function ContributionForm({ ceremonies, initial, onSave, onClose }: { ceremonies: Ceremony[]; initial?: Contribution; onSave: (entry: Contribution) => void; onClose: () => void }) {
  const { workspace, isPreview } = useWorkspace()
  const [contributor, setContributor] = useState(initial?.contributor ?? '')
  const [ceremonyId, setCeremonyId] = useState(initial?.ceremonyId ?? '')
  const [receivedPercent, setReceivedPercent] = useState(initial ? String(initial.receivedPercent) : '0')
  const [date, setDate] = useState(initial?.date ?? '')
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? 'NGN')
  const [amount, setAmount] = useState(initial ? String(initial.originalAmount) : '')
  const [rate, setRate] = useState(initial ? String(initial.exchangeRate) : '1')
  const [rateSource, setRateSource] = useState(initial?.rateSource ?? 'native')
  const amountNgn = toAmount(amount) * (currency === 'NGN' ? 1 : toAmount(rate))
  const rawPercent = toAmount(receivedPercent)
  const percent = Math.min(rawPercent, 100)
  const receivedNgn = amountNgn * percent / 100
  const canSubmit = Boolean(contributor.trim() && toAmount(amount) > 0 && amountNgn > 0 && rawPercent <= 100 && (percent === 0 || date))

  function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault()
    if (!canSubmit) return
    const ceremony = ceremonies.find((item) => item.id === ceremonyId)
    onSave({ id: initial?.id ?? crypto.randomUUID(), kind: 'contribution', contributor: contributor.trim(), ceremonyId, ceremony: ceremony?.name ?? GENERAL_EVENT, receivedPercent: percent, receivedNgn, status: percent >= 100 ? 'received' : percent > 0 ? 'partial' : 'pledged', date, currency, originalAmount: toAmount(amount), exchangeRate: currency === 'NGN' ? 1 : toAmount(rate), amountNgn, rateSource })
  }

  async function lookup(nextCurrency: Currency, nextDate = date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date())) { setCurrency(nextCurrency); if (nextCurrency === 'NGN') { setRate('1'); setRateSource('native'); return } if (isPreview) { setRateSource('manual'); return } try { const result = await fetchNgnRate(workspace.id, nextCurrency, nextDate); setRate(String(result.rate)); setRateSource(result.source) } catch { setRateSource('manual') } }

  return <MoneyForm title={initial ? 'Edit contribution' : 'Add a contribution'} eyebrow={initial ? 'Update incoming record' : 'New incoming record'} submitLabel={initial ? 'Save changes' : 'Add contribution'} canSubmit={canSubmit} currency={currency} amount={amount} rate={rate} rateSource={rateSource} amountNgn={amountNgn} onCurrency={(value) => void lookup(value)} onAmount={setAmount} onRate={(value) => { setRate(value); setRateSource('manual') }} onClose={onClose} onSubmit={submit}>
    <label className="budget-field field-span-2"><span>Contributor or source</span><input autoFocus value={contributor} onChange={(change) => setContributor(change.target.value)} placeholder="Name or funding source" /></label>
    <CeremonyField value={ceremonyId} ceremonies={ceremonies} onChange={setCeremonyId} />
    <label className="budget-field"><span>Percentage received</span><input type="number" min="0" max="100" step="1" value={receivedPercent} onChange={(change) => setReceivedPercent(change.target.value)} /></label>
    <label className="budget-field"><span>Received date <small>{percent > 0 ? 'required' : 'optional'}</small></span><input type="date" required={percent > 0} value={date} onChange={(change) => { setDate(change.target.value); void lookup(currency, change.target.value) }} /></label>
    <div className="contribution-progress field-span-2"><span>{percent}% received</span><strong>{formatNgn(receivedNgn)} received</strong><small>{formatNgn(Math.max(amountNgn - receivedNgn, 0))} balance</small><i><b style={{ width: `${percent}%` }} /></i></div>
  </MoneyForm>
}

function AllocationField({ value, allocations, onChange }: { value: string; allocations: Allocation[]; onChange: (value: string) => void }) {
  return <label className="budget-field"><span>Allocation</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Unallocated</option>{allocations.map((allocation) => <option value={allocation.id} key={allocation.id}>{allocation.name}</option>)}</select></label>
}

function CeremonyField({ value, ceremonies, onChange }: { value: string; ceremonies: Ceremony[]; onChange: (value: string) => void }) {
  return <label className="budget-field"><span>Ceremony</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">General / shared</option>{ceremonies.map((ceremony) => <option value={ceremony.id} key={ceremony.id}>{ceremony.name}</option>)}</select></label>
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

function LedgerRow({ entry, onEdit, onDelete, onStatusChange }: { entry: LedgerEntry; onEdit: (entry: LedgerEntry) => void; onDelete: (entry: LedgerEntry) => void; onStatusChange: (id: string, status: EntryStatus) => void }) {
  const title = entry.kind === 'expense' ? entry.description : entry.contributor
  const subtitle = entry.kind === 'expense' ? entry.category : 'Contribution'
  return (
    <article className="ledger-row">
      <div className="ledger-record"><span className={`ledger-kind ${entry.kind}`}>{entry.kind === 'expense' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}</span><div><strong>{title}</strong><small>{subtitle}{entry.date ? ` · ${entry.date}` : ''}</small></div></div>
      <div className="ledger-scope">{entry.kind === 'expense' && <span className="ledger-allocation">{entry.allocation}</span>}<span className="ledger-event">{entry.ceremony}</span></div>
      <div className="ledger-source"><strong>{formatOriginal(entry)}</strong><small>{entry.kind === 'contribution' ? `${entry.receivedPercent}% received · ${formatNgn(entry.amountNgn - entry.receivedNgn)} balance` : `Rate: NGN ${numberFormatter.format(entry.exchangeRate)}`}</small></div>
      <strong className={`ledger-ngn ${entry.kind}`}>{entry.kind === 'expense' ? '−' : '+'}{formatNgn(entry.kind === 'contribution' ? entry.receivedNgn : entry.amountNgn)}</strong>
      {entry.kind === 'expense' ? <label className={`payment-status status-${entry.status}`}><span className="sr-only">Update status for {title}</span><select value={entry.status} onChange={(event) => onStatusChange(entry.id, event.target.value as EntryStatus)}><option value="planned">Planned</option><option value="due">Due</option><option value="paid">Paid</option></select></label> : <span className={`contribution-status ${pillTone(entry.status)}`}>{entry.status === 'partial' ? `${Math.round(entry.receivedPercent)}% received` : entry.status}</span>}
      <div className="ledger-actions"><button className="budget-icon-button ledger-edit" type="button" aria-label={`Edit ${title}`} onClick={() => onEdit(entry)}><Pencil size={13} /></button><button className="budget-icon-button ledger-delete" type="button" aria-label={`Delete ${title}`} onClick={() => onDelete(entry)}><Trash2 size={13} /></button></div>
    </article>
  )
}
