import { requireSupabase } from './supabase'

export type IdoAiMessage = {
  id: string
  role: 'assistant' | 'user'
  body: string
  createdAt: string
}

export type IdoAiAction = {
  id: string
  title: string
  description: string
  destination: string
  status: 'proposed' | 'approved' | 'rejected' | 'executing' | 'executed' | 'failed' | 'cancelled'
}

export type IdoAiBatch = {
  id: string
  summary: string
  status: 'proposed' | 'partially_approved' | 'approved' | 'executing' | 'completed' | 'failed' | 'rejected' | 'cancelled'
  actions: IdoAiAction[]
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
  action_type: string
  resource_type: string
  payload: Record<string, unknown>
  rationale: string | null
  status: IdoAiAction['status']
}

type BatchRow = {
  id: string
  summary: string
  status: IdoAiBatch['status']
  agent_actions: ActionRow[]
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
  const [{ data: messages, error: messagesError }, { data: batches, error: batchesError }] = await Promise.all([
    db.from('agent_messages').select('id,role,content,created_at').eq('workspace_id', workspaceId).eq('conversation_id', conversation.id).in('role', ['user', 'assistant']).order('created_at'),
    db.from('agent_action_batches').select('id,summary,status,created_at,agent_actions(id,action_type,resource_type,payload,rationale,status)').eq('workspace_id', workspaceId).eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(5),
  ])
  if (messagesError || batchesError) throw messagesError ?? batchesError
  return {
    conversationId: conversation.id,
    messages: (messages ?? []).map((message) => ({ id: message.id, role: message.role as 'assistant' | 'user', body: message.content, createdAt: message.created_at })),
    batches: ((batches ?? []) as BatchRow[]).map((batch) => ({ ...batch, actions: batch.agent_actions.sort((left, right) => left.id.localeCompare(right.id)).map(mapAction) })),
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

function mapAction(action: ActionRow): IdoAiAction {
  const payload = action.payload ?? {}
  const subject = text(payload.title) ?? text(payload.name) ?? text(payload.query) ?? action.resource_type.replaceAll('_', ' ')
  return {
    id: action.id,
    title: `${action.action_type === 'create' ? 'Add' : 'Update'} ${subject}`,
    description: action.rationale ?? summarizePayload(payload),
    destination: action.resource_type.replaceAll('_', ' '),
    status: action.status,
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
