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

export type IdoAiConversation = {
  id: string
  title: string
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
}

export type IdoAiState = {
  conversationId: string | null
  conversations: IdoAiConversation[]
  messages: IdoAiMessage[]
  batches: IdoAiBatch[]
  job: IdoAiJob | null
  onboardingStatus: 'not_started' | 'in_progress' | 'completed'
  onboardingStep: number
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

export async function loadIdoAiState(workspaceId: string, selectedConversationId?: string | null): Promise<IdoAiState> {
  const db = requireSupabase()
  const [{ data: conversationRows, error: conversationError }, { data: suggestions, error: suggestionError }, { data: profile, error: profileError }] = await Promise.all([
    db.from('agent_conversations').select('id,title,status,created_at,updated_at').eq('workspace_id', workspaceId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(50),
    db.from('agent_suggestions').select('id,title,body,priority').eq('workspace_id', workspaceId).eq('status', 'open').is('deleted_at', null).order('created_at', { ascending: false }).limit(5),
    db.from('agent_planning_profiles').select('onboarding_status,onboarding_answers').eq('workspace_id', workspaceId).maybeSingle(),
  ])
  if (conversationError || suggestionError || profileError) throw conversationError ?? suggestionError ?? profileError
  const conversations = (conversationRows ?? []).map((conversation) => ({ id: conversation.id, title: conversation.title, status: conversation.status as IdoAiConversation['status'], createdAt: conversation.created_at, updatedAt: conversation.updated_at }))
  const conversation = selectedConversationId === null
    ? null
    : selectedConversationId
    ? conversations.find((item) => item.id === selectedConversationId) ?? null
    : conversations.find((item) => item.status === 'active') ?? conversations[0] ?? null
  const onboardingStatus = (profile?.onboarding_status as IdoAiState['onboardingStatus'] | undefined) ?? 'not_started'
  const onboardingAnswers = profile?.onboarding_answers && typeof profile.onboarding_answers === 'object' && !Array.isArray(profile.onboarding_answers) ? profile.onboarding_answers as Record<string, unknown> : {}
  const onboardingStep = onboardingStatus === 'completed' ? 6 : Object.keys(onboardingAnswers).length

  if (!conversation) return { conversationId: null, conversations, messages: [], batches: [], job: null, onboardingStatus, onboardingStep, suggestionCount: suggestions?.length ?? 0, suggestions: suggestions ?? [] }
  const [{ data: messages, error: messagesError }, { data: batches, error: batchesError }, { data: audits, error: auditsError }, { data: run, error: runError }] = await Promise.all([
    db.from('agent_messages').select('id,role,content,run_id,metadata,created_at').eq('workspace_id', workspaceId).eq('conversation_id', conversation.id).in('role', ['user', 'assistant']).order('created_at'),
    db.from('agent_action_batches').select('id,summary,status,run_id,created_at,agent_actions(id,position,action_type,resource_type,payload,rationale,status,execution_error)').eq('workspace_id', workspaceId).eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(20),
    db.from('agent_audit_logs').select('action_id,event_type,created_at').eq('workspace_id', workspaceId).in('event_type', ['research_searching', 'research_processing']).order('created_at', { ascending: false }).limit(100),
    db.from('agent_runs').select('id,status,error_message,input,created_at').eq('workspace_id', workspaceId).eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (messagesError || batchesError || auditsError || runError) throw messagesError ?? batchesError ?? auditsError ?? runError
  return {
    conversationId: conversation.id,
    conversations,
    messages: (messages ?? []).map((message) => ({ id: message.id, role: message.role as 'assistant' | 'user', body: message.content, createdAt: message.created_at, runId: message.run_id, metadata: message.metadata ?? {} })),
    batches: ((batches ?? []) as BatchRow[]).map((batch) => ({ id: batch.id, summary: batch.summary, status: batch.status, runId: batch.run_id, createdAt: batch.created_at, actions: batch.agent_actions.sort((left, right) => left.position - right.position).map((action) => mapAction(action, (audits ?? []) as AuditRow[])) })),
    job: mapJob(run),
    onboardingStatus,
    onboardingStep,
    suggestionCount: suggestions?.length ?? 0,
    suggestions: suggestions ?? [],
  }
}

export async function uploadIdoAiImage(workspaceId: string, userId: string, file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image')
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB')
  const db = requireSupabase()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-') || 'chat-image'
  const storagePath = `${workspaceId}/${crypto.randomUUID()}/${safeName}`
  const { error: storageError } = await db.storage.from('wedding-files').upload(storagePath, file, { contentType: file.type, upsert: false })
  if (storageError) throw storageError
  const { data, error } = await db.from('files').insert({ workspace_id: workspaceId, bucket_id: 'wedding-files', storage_path: storagePath, original_name: file.name, mime_type: file.type, size_bytes: file.size, category: 'I Do AI', description: 'Chat image', uploaded_by: userId, created_by: userId, updated_by: userId }).select('id').single()
  if (error) {
    await db.storage.from('wedding-files').remove([storagePath])
    throw error
  }
  return data.id as string
}

export async function sendIdoAiMessage(workspaceId: string, conversationId: string | null, content: string, requestId: string, fileId?: string) {
  const { data, error } = await requireSupabase().functions.invoke('agent-message', { body: { workspaceId, conversationId: conversationId ?? crypto.randomUUID(), requestId, content, fileId } })
  if (error) throw error
  return data as { conversationId: string; runId: string }
}

export async function reviewIdoAiBatch(workspaceId: string, batchId: string, decision: 'approve' | 'reject') {
  const { data, error } = await requireSupabase().functions.invoke('review-action-batch', { body: { workspaceId, batchId, decision } })
  if (error) throw error
  return data
}

export async function archiveIdoAiConversation(workspaceId: string, conversationId: string) {
  const { error } = await requireSupabase().from('agent_conversations').update({ status: 'archived' }).eq('workspace_id', workspaceId).eq('id', conversationId)
  if (error) throw error
}

export async function saveIdoAiOnboarding(workspaceId: string, step: number, prompt: string, answer: string | null, completed: boolean) {
  const db = requireSupabase()
  const { data: existing, error: loadError } = await db.from('agent_planning_profiles').select('onboarding_answers').eq('workspace_id', workspaceId).maybeSingle()
  if (loadError) throw loadError
  const answers = existing?.onboarding_answers && typeof existing.onboarding_answers === 'object' && !Array.isArray(existing.onboarding_answers) ? existing.onboarding_answers : {}
  const { error } = await db.from('agent_planning_profiles').upsert({
    workspace_id: workspaceId,
    onboarding_status: completed ? 'completed' : 'in_progress',
    onboarding_answers: { ...answers, [String(step)]: { prompt, answer: answer ?? 'Skipped' } },
  }, { onConflict: 'workspace_id' })
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
