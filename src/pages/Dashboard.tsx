import {
  ArrowUpRight,
  CalendarPlus,
  Check,
  ChevronRight,
  Circle,
  CircleDollarSign,
  ListPlus,
  Plus,
  Shirt,
  Users,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatNaira } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'

const emptyCeremonies = [
  { name: 'Court', code: '01', state: 'Date not set', progress: 0 },
  { name: 'Traditional', code: '02', state: 'Date not set', progress: 0 },
  { name: 'White', code: '03', state: 'Date not set', progress: 0 },
]

const setupItems = [
  { label: 'Add ceremony dates', to: '/ceremonies' },
  { label: 'Set the wedding budget', to: '/budget' },
  { label: 'Import the first guest list', to: '/guests' },
  { label: 'Add known vendors', to: '/vendors' },
]

export function Dashboard() {
  const { workspace, isPreview } = useWorkspace()
  const dashboardQuery = useQuery({
    queryKey: ['dashboard', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const [ceremonyResult, taskResult, guestResult, allocationResult, expenseResult, contributionResult, attireResult, requirementResult, seatingResult] = await Promise.all([
        supabase!.from('ceremonies').select('id,name,kind,status,starts_at').eq('workspace_id', workspace.id).is('deleted_at', null),
        supabase!.from('tasks').select('id,status').eq('workspace_id', workspace.id).is('deleted_at', null),
        supabase!.from('guests').select('id').eq('workspace_id', workspace.id).is('deleted_at', null),
        supabase!.from('budget_allocations').select('planned_minor').eq('workspace_id', workspace.id).is('deleted_at', null),
        supabase!.from('expenses').select('ngn_minor,status').eq('workspace_id', workspace.id).is('deleted_at', null),
        supabase!.from('contributions').select('ngn_received_minor').eq('workspace_id', workspace.id).is('deleted_at', null),
        supabase!.from('attire_orders').select('id,payment_status').eq('workspace_id', workspace.id).is('deleted_at', null),
        supabase!.from('traditional_requirements').select('id,status').eq('workspace_id', workspace.id).is('deleted_at', null),
        supabase!.from('seating_assignments').select('id').eq('workspace_id', workspace.id).is('deleted_at', null),
      ])
      const error = [ceremonyResult, taskResult, guestResult, allocationResult, expenseResult, contributionResult, attireResult, requirementResult, seatingResult].find((result) => result.error)?.error
      if (error) throw error
      return { ceremonies: ceremonyResult.data, tasks: taskResult.data, guests: guestResult.data, allocations: allocationResult.data, expenses: expenseResult.data, contributions: contributionResult.data, attire: attireResult.data, requirements: requirementResult.data, seating: seatingResult.data }
    },
  })
  const data = dashboardQuery.data
  const ceremonies = data ? (data.ceremonies ?? []).map((ceremony, index) => ({ name: ceremony.name.replace(/ Wedding$/i, ''), code: `0${index + 1}`, state: ceremony.starts_at ? new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ceremony.starts_at)) : 'Date not set', progress: ceremony.status === 'completed' ? 100 : ceremony.status === 'confirmed' ? 50 : 0 })) : emptyCeremonies
  const openTasks = (data?.tasks ?? []).filter((task) => task.status !== 'done').length
  const completedTasks = (data?.tasks ?? []).filter((task) => task.status === 'done').length
  const allocated = (data?.allocations ?? []).reduce((sum, item) => sum + item.planned_minor, 0) / 100
  const payments = (data?.expenses ?? []).filter((expense) => expense.status === 'paid').length
  const today = new Intl.DateTimeFormat('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date())

  return (
    <div className="page dashboard-page">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">{today}</p>
          <h1>The wedding office</h1>
          <p className="page-lead">Three celebrations. One clear view of what comes next.</p>
        </div>
        <div className="header-actions">
          <button className="button secondary" type="button"><CalendarPlus size={16} /> Add date</button>
          <button className="button primary" type="button"><Plus size={16} /> New task</button>
        </div>
      </header>

      <section className="ceremony-strip" aria-label="Ceremonies">
        {ceremonies.map((ceremony) => (
          <Link className="ceremony-card" to="/ceremonies" key={ceremony.name}>
            <div className="ceremony-topline">
              <span className="ceremony-number">{ceremony.code}</span>
              <ArrowUpRight size={17} />
            </div>
            <div>
              <h2>{ceremony.name}</h2>
              <p>{ceremony.state}</p>
            </div>
            <div className="progress-row">
              <span>Planning progress</span><strong>{ceremony.progress}%</strong>
            </div>
            <div className="progress-track"><span style={{ width: `${ceremony.progress}%` }} /></div>
          </Link>
        ))}
      </section>

      <section className="metric-grid">
        <MetricCard icon={ListPlus} label="Open tasks" value={String(openTasks)} detail={openTasks ? 'Across all ceremonies' : 'Nothing due yet'} to="/tasks" />
        <MetricCard icon={CircleDollarSign} label="Total budget" value={formatNaira(allocated)} detail={allocated ? 'Allocated across events' : 'Not allocated'} to="/budget" />
        <MetricCard icon={Users} label="Guests" value={String(data?.guests?.length ?? 0)} detail="Across all events" to="/guests" />
        <MetricCard icon={Shirt} label="Attire orders" value={String(data?.attire?.length ?? 0)} detail="All outfit groups" to="/attire" />
      </section>

      <section className="dashboard-columns">
        <div className="panel focus-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Start here</p>
              <h2>Set up the essentials</h2>
            </div>
            <span className="quiet-badge">0 of {setupItems.length}</span>
          </div>
          <div className="setup-list">
            {setupItems.map((item, index) => (
              <Link to={item.to} className="setup-item" key={item.label}>
                <span className="setup-index">0{index + 1}</span>
                <span className="setup-label">{item.label}</span>
                <ChevronRight size={17} />
              </Link>
            ))}
          </div>
        </div>

        <div className="panel activity-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">This week</p>
              <h2>Planning pulse</h2>
            </div>
          </div>
          <div className="pulse-list">
            <PulseRow icon={Circle} label="Tasks completed" value={String(completedTasks)} />
            <PulseRow icon={Users} label="RSVP changes" value="0" />
            <PulseRow icon={CircleDollarSign} label="Payments recorded" value={String(payments)} />
            <PulseRow icon={Check} label="Requirements sourced" value={String((data?.requirements ?? []).filter((item) => ['sourced', 'delivered', 'approved', 'complete'].includes(item.status)).length)} />
          </div>
          <p className="empty-note">Activity will appear here as you begin planning.</p>
        </div>
      </section>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, detail, to }: {
  icon: typeof Users
  label: string
  value: string
  detail: string
  to: string
}) {
  return (
    <Link className="metric-card" to={to}>
      <div className="metric-icon"><Icon size={17} /></div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </Link>
  )
}

function PulseRow({ icon: Icon, label, value }: { icon: typeof Circle; label: string; value: string }) {
  return (
    <div className="pulse-row">
      <Icon size={15} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
