import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentication required' }, 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401)
    const body = await request.json() as { workspaceId?: string; fileId?: string }
    if (!isUuid(body.workspaceId) || !isUuid(body.fileId)) return json({ error: 'Valid workspaceId and fileId are required' }, 400)
    const [{ data: membership }, { data: file }] = await Promise.all([
      userClient.from('workspace_members').select('workspace_id').eq('workspace_id', body.workspaceId).eq('profile_id', userData.user.id).maybeSingle(),
      userClient.from('files').select('id,original_name').eq('workspace_id', body.workspaceId).eq('id', body.fileId).is('deleted_at', null).maybeSingle(),
    ])
    if (!membership) return json({ error: 'Workspace access denied' }, 403)
    if (!file) return json({ error: 'File not found' }, 404)
    const { data: existingConversation } = await userClient.from('agent_conversations').select('id').eq('workspace_id', body.workspaceId).eq('status', 'active').is('deleted_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    let conversationId = existingConversation?.id
    if (!conversationId) {
      const { data: conversation, error } = await admin.from('agent_conversations').insert({ workspace_id: body.workspaceId, title: `Review ${file.original_name}`, created_by: userData.user.id, updated_by: userData.user.id }).select('id').single()
      if (error) throw error
      conversationId = conversation.id
    }
    const runId = crypto.randomUUID()
    const messageId = crypto.randomUUID()
    const { error: runError } = await admin.from('agent_runs').insert({ id: runId, workspace_id: body.workspaceId, conversation_id: conversationId, status: 'queued', model: 'gpt-5.6-luna', input: { kind: 'document_analysis', file_id: file.id }, created_by: userData.user.id })
    if (runError) throw runError
    const { error: messageError } = await admin.from('agent_messages').insert({ id: messageId, workspace_id: body.workspaceId, conversation_id: conversationId, run_id: runId, role: 'user', content: `Analyse ${file.original_name} and propose relevant planning updates.`, created_by: userData.user.id })
    if (messageError) throw messageError
    const payload = { workspaceId: body.workspaceId, requesterId: userData.user.id, fileId: file.id, conversationId, runId, messageId, sourceRef: file.id }
    const triggerResponse = await fetch('https://api.trigger.dev/api/v1/tasks/ido-ai-document-analysis/trigger', { method: 'POST', headers: { Authorization: `Bearer ${requiredSecret('TRIGGER_SECRET_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ payload, options: { idempotencyKey: runId } }) })
    const triggerBody = await triggerResponse.json() as { id?: string }
    if (!triggerResponse.ok || !triggerBody.id) {
      await admin.from('agent_runs').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', runId)
      throw new Error('Document analysis queue is unavailable')
    }
    await admin.from('agent_runs').update({ input: { kind: 'document_analysis', file_id: file.id, trigger_run_id: triggerBody.id } }).eq('id', runId)
    return json({ conversationId, runId, status: 'queued' }, 202)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})

function requiredSecret(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`${name} is not configured`); return value }
function isUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
