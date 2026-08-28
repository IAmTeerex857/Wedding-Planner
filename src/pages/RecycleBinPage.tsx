import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Trash2 } from '../components/KoboyoIcon'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import './recycle-bin.css'

type RecycledItem = { id: string; table: string; module: string; label: string; deletedAt: string }
const sources = [
  ['tasks', 'Tasks', 'title'], ['guests', 'Guests', 'full_name'], ['vendors', 'Vendors', 'name'], ['venues', 'Venues', 'name'],
  ['expenses', 'Budget', 'description'], ['contributions', 'Budget', 'contributor_name'], ['attire_orders', 'Attire', 'recipient_name'],
  ['traditional_requirements', 'Traditional requirements', 'item_name'], ['gifts', 'Gifts', 'description'], ['files', 'Files', 'original_name'],
] as const

export function RecycleBinPage() {
  const { workspace, userId, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const itemsQuery = useQuery({
    queryKey: ['recycle-bin', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const groups = await Promise.all(sources.map(async ([table, module, labelColumn]) => {
        const { data, error } = await supabase!.from(table).select(`id,deleted_at,${labelColumn}`).eq('workspace_id', workspace.id).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
        if (error) throw error
        return data.map((row) => {
          const record = row as unknown as Record<string, unknown>
          return { id: String(record.id), table, module, label: String(record[labelColumn] ?? 'Untitled record'), deletedAt: String(record.deleted_at) }
        })
      }))
      return groups.flat() as RecycledItem[]
    },
  })
  const restoreMutation = useMutation({
    mutationFn: async (item: RecycledItem) => {
      const { error } = await supabase!.from(item.table).update({ deleted_at: null, updated_by: userId }).eq('id', item.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recycle-bin', workspace.id] }),
  })
  const items = itemsQuery.data ?? []

  return <div className="page recycle-page"><header className="page-header"><div><p className="eyebrow">30-day recovery</p><h1>Recycle bin</h1><p className="page-lead">Restore accidentally removed records. Permanent cleanup only processes records that have remained here for more than 30 days.</p></div></header>{(itemsQuery.error || restoreMutation.error) && <p className="data-error">{itemsQuery.error?.message ?? restoreMutation.error?.message}</p>}<section className="recycle-list"><header><span>Record</span><span>Module</span><span>Deleted</span><span /></header>{items.length ? items.map((item) => <article key={`${item.table}-${item.id}`}><div><Trash2 size={15} /><strong>{item.label}</strong></div><span>{item.module}</span><time>{new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(new Date(item.deletedAt))}</time><button type="button" onClick={() => restoreMutation.mutate(item)}><RotateCcw size={14} /> Restore</button></article>) : <div className="recycle-empty"><Trash2 size={22} /><h2>Nothing to restore</h2><p>Deleted records will appear here for 30 days.</p></div>}</section></div>
}
