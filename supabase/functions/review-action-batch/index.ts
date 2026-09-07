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
    const body = await request.json() as { workspaceId?: string; batchId?: string; decision?: 'approve' | 'reject' }
    if (!isUuid(body.workspaceId) || !isUuid(body.batchId) || !['approve', 'reject'].includes(body.decision ?? '')) return response({ error: 'Invalid review request' }, 400)
    const { data: membership } = await userClient.from('workspace_members').select('workspace_id').eq('workspace_id', body.workspaceId).eq('profile_id', userData.user.id).maybeSingle()
    if (!membership) return response({ error: 'Workspace access denied' }, 403)
    const { data: batch } = await userClient.from('agent_action_batches').select('id,status').eq('id', body.batchId).eq('workspace_id', body.workspaceId).in('status', ['proposed', 'approved', 'rejected']).maybeSingle()
    if (!batch) return response({ error: 'Action batch is unavailable' }, 409)
    const desiredStatus = body.decision === 'approve' ? 'approved' : 'rejected'
    if (batch.status !== desiredStatus) {
      if (batch.status !== 'proposed') return response({ error: `This batch was already ${batch.status}` }, 409)
      const { error } = await userClient.rpc('review_agent_action_batch', { target_batch_id: batch.id, approve: body.decision === 'approve' })
      if (error) throw new Error(error.message)
    }
    const { count: actionsReviewed, error: actionsError } = await userClient.from('agent_actions').select('id', { count: 'exact', head: true }).eq('batch_id', batch.id).eq('workspace_id', body.workspaceId)
    if (actionsError) throw new Error('Could not load action batch')
    let triggerRunId: string | null = null
    if (body.decision === 'approve') {
      const payload = { workspaceId: body.workspaceId, batchId: batch.id, requesterId: userData.user.id }
      const triggerResponse = await fetch('https://api.trigger.dev/api/v1/tasks/ido-ai-execute-action-batch/trigger', {
        method: 'POST',
        headers: { Authorization: `Bearer ${requiredSecret('TRIGGER_SECRET_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, options: { idempotencyKey: batch.id } }),
      })
      const triggerBody = await triggerResponse.json() as { id?: string }
      if (!triggerResponse.ok || !triggerBody.id) throw new Error('Action executor is unavailable')
      triggerRunId = triggerBody.id
    }
    return response({ id: batch.id, status: desiredStatus, actionsReviewed: actionsReviewed ?? 0, triggerRunId })
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})

function isUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function requiredSecret(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`${name} is not configured`); return value }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
