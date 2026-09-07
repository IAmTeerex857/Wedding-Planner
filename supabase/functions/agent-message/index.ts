import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return response({ error: 'Authentication required' }, 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) return response({ error: 'Invalid session' }, 401)
    const body = await request.json() as { workspaceId?: string; conversationId?: string; requestId?: string; content?: string }
    if (!isUuid(body.workspaceId)) return response({ error: 'A valid workspaceId is required' }, 400)
    const content = body.content?.trim()
    if (!content || content.length > 8_000) return response({ error: 'Message must contain 1 to 8000 characters' }, 400)
    if (!isUuid(body.conversationId) || !isUuid(body.requestId)) return response({ error: 'conversationId and requestId must be UUIDs' }, 400)
    const { data: membership } = await userClient.from('workspace_members').select('workspace_id').eq('workspace_id', body.workspaceId).eq('profile_id', userData.user.id).maybeSingle()
    if (!membership) return response({ error: 'Workspace access denied' }, 403)

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const conversationId = body.conversationId
    const { data: existingConversation } = await userClient.from('agent_conversations').select('id,status').eq('id', conversationId).eq('workspace_id', body.workspaceId).is('deleted_at', null).maybeSingle()
    const { error: archiveError } = await admin.from('agent_conversations').update({ status: 'archived', updated_by: userData.user.id }).eq('workspace_id', body.workspaceId).eq('status', 'active').neq('id', conversationId)
    if (archiveError) throw new Error('Could not update conversation history')
    if (!existingConversation) {
      const { error: conversationError } = await admin.from('agent_conversations').insert({ id: conversationId, workspace_id: body.workspaceId, title: content.slice(0, 80), created_by: userData.user.id, updated_by: userData.user.id })
      if (conversationError && conversationError.code !== '23505') throw new Error('Could not create conversation')
    } else {
      const { error: resumeError } = await admin.from('agent_conversations').update({ status: 'active', updated_by: userData.user.id, updated_at: new Date().toISOString() }).eq('id', conversationId).eq('workspace_id', body.workspaceId)
      if (resumeError) throw new Error('Could not resume conversation')
    }
    const { data: existingRun } = await admin.from('agent_runs').select('id,status').eq('id', body.requestId).eq('workspace_id', body.workspaceId).maybeSingle()
    if (existingRun) return response({ conversationId, messageId: body.requestId, runId: existingRun.id, status: existingRun.status }, 202)
    const { data: run, error: runError } = await admin.from('agent_runs').insert({ id: body.requestId, workspace_id: body.workspaceId, conversation_id: conversationId, status: 'queued', model: 'gpt-5.6-luna', input: { kind: 'agent_turn' }, created_by: userData.user.id }).select('id').single()
    if (runError) throw new Error('Could not queue agent run')
    const { data: message, error: insertError } = await admin.from('agent_messages').insert({ id: body.requestId, workspace_id: body.workspaceId, conversation_id: conversationId, run_id: run.id, role: 'user', content, created_by: userData.user.id }).select('id').single()
    if (insertError) { await admin.from('agent_runs').delete().eq('id', run.id); throw new Error('Could not queue message') }

    const triggerPayload = { workspaceId: body.workspaceId, conversationId, runId: run.id, messageId: message.id, requesterId: userData.user.id }
    const triggerResponse = await fetch('https://api.trigger.dev/api/v1/tasks/ido-ai-agent-turn/trigger', {
      method: 'POST',
      headers: { Authorization: `Bearer ${requiredSecret('TRIGGER_SECRET_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: triggerPayload, options: { idempotencyKey: message.id } }),
    })
    const triggerBody = await triggerResponse.json() as { id?: string }
    if (!triggerResponse.ok || !triggerBody.id) {
      await admin.from('agent_runs').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', run.id)
      throw new Error('Workflow queue is unavailable')
    }
    await admin.from('agent_runs').update({ input: { kind: 'agent_turn', trigger_run_id: triggerBody.id } }).eq('id', run.id)
    return response({ conversationId, messageId: message.id, runId: run.id, triggerRunId: triggerBody.id, status: 'queued' }, 202)
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})

function requiredSecret(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`${name} is not configured`); return value }
function isUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
