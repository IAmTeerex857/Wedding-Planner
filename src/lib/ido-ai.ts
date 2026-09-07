import { requireSupabase } from './supabase'

export type IdoAiMessage = {
  id: string
  role: 'assistant' | 'user'
  body: string
  createdAt: string
  runId: string | null
  metadata: Record<string, unknown>
}

export type IdoAiAction = {
  id: string
  title: string
  description: string
  destination: string
  status: 'proposed' | 'approved' | 'rejected' | 'executing' | 'executed' | 'failed' | 'cancelled'
  sources: string[]
  progress: 'queued' | 'searching' | 'processing' | 'completed' | 'failed' | null
  error: string | null
}

export type IdoAiBatch = {
  id: string
  summary: string
  status: 'proposed' | 'partially_approved' | 'approved' | 'executing' | 'completed' | 'failed' | 'rejected' | 'cancelled'
  actions: IdoAiAction[]
  runId: string | null
  createdAt: string
}

export type IdoAiJob = {
  id: string
  label: string
  detail: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  kind: string
}

export type IdoAiState = {
  conversationId: string | null
  messages: IdoAiMessage[]
  batches: IdoAiBatch[]
  job: IdoAiJob | null
  suggestionCount: number
  suggestions: Array<{ id: string; title: string; body: string; priority: string }>
}

type ActionRow = {
  id: string
  position: number
  action_type: string
  resource_type: string
  payload: Record<string, unknown>
  rationale: string | null
  status: IdoAiAction['status']
  execution_error: string | null
}

type BatchRow = {
  id: string
  summary: string
  status: IdoAiBatch['status']
  run_id: string | null
  created_at: string
  agent_actions: ActionRow[]
}

type AuditRow = {
  action_id: string | null
  event_type: string
  created_at: string
}

export async function loadIdoAiState(workspaceId: string): Promise<IdoAiState> {
  const db = requireSupabase()
  const { data: conversation, error: conversationError } = await db.from('agent_conversations').select('id').eq('workspace_id', workspaceId).eq('status', 'active').is('deleted_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (conversationError) throw conversationError

  const [{ data: suggestions, error: suggestionError }, { data: run, error: runError }] = await Promise.all([
    db.from('agent_suggestions').select('id,title,body,priority').eq('workspace_id', workspaceId).eq('status', 'open').is('deleted_at', null).order('created_at', { ascending: false }).limit(5),
    db.from('agent_runs').select('id,status,error_message,input,created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (suggestionError || runError) throw suggestionError ?? runError

  if (!conversation) return { conversationId: null, messages: [], batches: [], job: mapJob(run), suggestionCount: suggestions?.length ?? 0, suggestions: suggestions ?? [] }
  const [{ data: messages, error: messagesError }, { data: batches, error: batchesError }, { data: audits, error: auditsError }] = await Promise.all([
    db.from('agent_messages').select('id,role,content,run_id,metadata,created_at').eq('workspace_id', workspaceId).eq('conversation_id', conversation.id).in('role', ['user', 'assistant']).order('created_at'),
    db.from('agent_action_batches').select('id,summary,status,run_id,created_at,agent_actions(id,position,action_type,resource_type,payload,rationale,status,execution_error)').eq('workspace_id', workspaceId).eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(20),
    db.from('agent_audit_logs').select('action_id,event_type,created_at').eq('workspace_id', workspaceId).in('event_type', ['research_searching', 'research_processing']).order('created_at', { ascending: false }).limit(100),
  ])
  if (messagesError || batchesError || auditsError) throw messagesError ?? batchesError ?? auditsError
  return {
    conversationId: conversation.id,
    messages: (messages ?? []).map((message) => ({ id: message.id, role: message.role as 'assistant' | 'user', body: message.content, createdAt: message.created_at, runId: message.run_id, metadata: message.metadata ?? {} })),
    batches: ((batches ?? []) as BatchRow[]).map((batch) => ({ id: batch.id, summary: batch.summary, status: batch.status, runId: batch.run_id, createdAt: batch.created_at, actions: batch.agent_actions.sort((left, right) => left.position - right.position).map((action) => mapAction(action, (audits ?? []) as AuditRow[])) })),
    job: mapJob(run),
    suggestionCount: suggestions?.length ?? 0,
    suggestions: suggestions ?? [],
  }
}

export async function sendIdoAiMessage(workspaceId: string, conversationId: string | null, content: string, requestId: string) {
  const { data, error } = await requireSupabase().functions.invoke('agent-message', { body: { workspaceId, conversationId: conversationId ?? crypto.randomUUID(), requestId, content } })
  if (error) throw error
  return data as { conversationId: string; runId: string }
}

export async function reviewIdoAiBatch(workspaceId: string, batchId: string, decision: 'approve' | 'reject') {
  const { data, error } = await requireSupabase().functions.invoke('review-action-batch', { body: { workspaceId, batchId, decision } })
  if (error) throw error
  return data
}

export async function deleteIdoAiConversation(workspaceId: string, conversationId: string) {
  const { error } = await requireSupabase().from('agent_conversations').update({ deleted_at: new Date().toISOString(), status: 'archived' }).eq('workspace_id', workspaceId).eq('id', conversationId)
  if (error) throw error
}

export async function dismissIdoAiSuggestion(workspaceId: string, suggestionId: string) {
  const { error } = await requireSupabase().from('agent_suggestions').update({ status: 'dismissed' }).eq('workspace_id', workspaceId).eq('id', suggestionId)
  if (error) throw error
}

function mapAction(action: ActionRow, audits: AuditRow[]): IdoAiAction {
  const payload = action.payload ?? {}
  const subject = text(payload.title) ?? text(payload.name) ?? text(payload.query) ?? action.resource_type.replaceAll('_', ' ')
  const latestProgress = audits.find((audit) => audit.action_id === action.id)?.event_type
  const progress = action.status === 'executed' ? 'completed'
    : action.status === 'failed' ? 'failed'
    : latestProgress === 'research_processing' ? 'processing'
    : latestProgress === 'research_searching' ? 'searching'
    : ['approved', 'executing'].includes(action.status) ? 'queued'
    : null
  return {
    id: action.id,
    title: action.resource_type === 'vendor_research' ? `Search for ${subject}` : `${action.action_type === 'create' ? 'Add' : 'Update'} ${subject}`,
    description: action.rationale ?? summarizePayload(payload),
    destination: action.resource_type.replaceAll('_', ' '),
    status: action.status,
    sources: stringArray(payload.research_platforms),
    progress,
    error: action.execution_error,
  }
}

function mapJob(run: { id: string; status: string; error_message?: string | null; input?: Record<string, unknown> | null } | null): IdoAiJob | null {
  if (!run) return null
  const status = run.status as IdoAiJob['status']
  return {
    id: run.id,
    status,
    kind: typeof run.input?.kind === 'string' ? run.input.kind : 'agent_turn',
    label: status === 'queued' ? 'I Do AI is queued' : status === 'running' ? 'I Do AI is working' : status === 'failed' ? 'I Do AI needs attention' : 'Planning review complete',
    detail: run.error_message ?? (status === 'completed' ? 'Your latest response and proposals are ready' : 'You can continue using the planner while this runs'),
  }
}

function summarizePayload(payload: Record<string, unknown>) {
  const values = Object.entries(payload).filter(([, value]) => value !== null && value !== '').slice(0, 3).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value)}`)
  return values.join(' · ') || 'Review this proposed change before it is applied.'
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : []
}
