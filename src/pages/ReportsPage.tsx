import { useQuery } from '@tanstack/react-query'
import { Download, FileText, Printer } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import './reports.css'

const csvReports = [
  { name: 'Guests & RSVP', file: 'guests', table: 'guests', columns: 'full_name,email,phone,plus_one_allowed,plus_one_name,created_at' },
  { name: 'Tasks', file: 'tasks', table: 'tasks', columns: 'title,status,priority,assignee_name,due_at,completed_at' },
  { name: 'Expenses', file: 'expenses', table: 'expenses', columns: 'description,category,status,amount_minor,currency,exchange_rate,ngn_minor,transaction_date' },
  { name: 'Contributions', file: 'contributions', table: 'contributions', columns: 'contributor_name,pledged_minor,received_minor,currency,exchange_rate,ngn_received_minor,received_on' },
  { name: 'Vendors', file: 'vendors', table: 'vendors', columns: 'name,category,website,package_details,selection_status,rating' },
  { name: 'Attire orders', file: 'attire-orders', table: 'attire_orders', columns: 'recipient_name,status,payment_status,currency,agreed_total_minor,created_at' },
  { name: 'Traditional requirements', file: 'traditional-requirements', table: 'traditional_requirements', columns: 'category,item_name,required_quantity,unit,responsible_party,estimated_minor,actual_minor,currency,due_date,status,approval_status' },
  { name: 'Gifts', file: 'gifts', table: 'gifts', columns: 'giver_name,description,gift_type,cash_amount_minor,currency,received_on,thank_you_status,thank_you_sent_on' },
] as const

export function ReportsPage() {
  const { workspace, isPreview } = useWorkspace()
  const summaryQuery = useQuery({
    queryKey: ['report-summary', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const results = await Promise.all(['guests', 'tasks', 'vendors', 'expenses', 'attire_orders', 'traditional_requirements'].map(async (table) => {
        const { count, error } = await supabase!.from(table).select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).is('deleted_at', null)
        if (error) throw error
        return [table, count ?? 0] as const
      }))
      return Object.fromEntries(results) as Record<string, number>
    },
  })

  async function exportCsv(report: typeof csvReports[number]) {
    const tableName: string = report.table
    const columns: string = report.columns
    const { data, error } = await supabase!.from(tableName).select(columns).eq('workspace_id', workspace.id).is('deleted_at', null)
    if (error || !data) return
    downloadCsv(`${report.file}.csv`, data as unknown as Record<string, unknown>[])
  }

  const counts = summaryQuery.data ?? {}
  return <div className="page reports-page"><header className="page-header"><div><p className="eyebrow">Exports & print</p><h1>Reports</h1><p className="page-lead">Download clean operational data or print the current page as a planning pack.</p></div><button className="button primary" type="button" onClick={() => window.print()}><Printer size={15} /> Print summary</button></header>
    <section className="report-summary"><div><strong>{counts.guests ?? 0}</strong><span>Guests</span></div><div><strong>{counts.tasks ?? 0}</strong><span>Tasks</span></div><div><strong>{counts.vendors ?? 0}</strong><span>Vendors</span></div><div><strong>{counts.expenses ?? 0}</strong><span>Expenses</span></div><div><strong>{counts.attire_orders ?? 0}</strong><span>Attire orders</span></div><div><strong>{counts.traditional_requirements ?? 0}</strong><span>Trad requirements</span></div></section>
    {summaryQuery.error && <p className="data-error">{summaryQuery.error.message}</p>}
    <section className="report-downloads">{csvReports.map((report) => <article key={report.file}><FileText size={18} /><div><strong>{report.name}</strong><small>Comma-separated data for backup or analysis</small></div><button type="button" disabled={isPreview} onClick={() => void exportCsv(report)}><Download size={14} /> CSV</button></article>)}</section>
  </div>
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [headers.map(escape).join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url)
}
