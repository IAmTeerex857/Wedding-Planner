import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type SendRequest = {
  workspaceId: string
  templateKey: 'connection_test' | 'planner_invitation'
  email?: string
  validDays?: number
  appUrl?: string
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) throw new Error('Authentication required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')
    if (!resendKey || !fromEmail) throw new Error('Email service is not configured')

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) throw new Error('Invalid session')

    const body = await request.json() as SendRequest
    if (!body.workspaceId || !['connection_test', 'planner_invitation'].includes(body.templateKey)) throw new Error('Unsupported email request')

    const { data: membership, error: membershipError } = await userClient
      .from('workspace_members')
      .select('workspace_id,role')
      .eq('workspace_id', body.workspaceId)
      .eq('profile_id', userData.user.id)
      .maybeSingle()
    if (membershipError || !membership) throw new Error('Workspace access denied')

    let recipient = userData.user.email
    let subject = 'Your wedding office is connected'
    let html = '<div style="font-family:Arial,sans-serif;color:#111"><h1 style="font-family:Georgia,serif;font-weight:400">Wedding planner</h1><p>Resend is connected to your private wedding office.</p></div>'
    let invitationLink: string | null = null
    if (body.templateKey === 'planner_invitation') {
      if (membership.role !== 'owner') throw new Error('Only workspace owners can invite planners')
      const email = body.email?.trim().toLocaleLowerCase()
      const validDays = Number(body.validDays ?? 7)
      if (!email || email.length > 320) throw new Error('A valid planner email is required')
      if (![1, 7, 14, 30].includes(validDays)) throw new Error('Invalid invitation expiry')
      const configuredAppUrl = Deno.env.get('APP_URL')
      const appUrl = new URL(configuredAppUrl ?? body.appUrl ?? '')
      if (!configuredAppUrl && !(appUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(appUrl.hostname))) throw new Error('APP_URL is not configured')
      if (appUrl.protocol !== 'https:' && appUrl.protocol !== 'http:') throw new Error('Invalid application URL')
      const { data: workspace, error: workspaceError } = await userClient.from('workspaces').select('name').eq('id', body.workspaceId).single()
      if (workspaceError || !workspace) throw new Error('Workspace not found')
      const { data: token, error: invitationError } = await userClient.rpc('create_workspace_planner_invitation', { target_workspace_id: body.workspaceId, invitee_email: email, valid_for: `${validDays} days` })
      if (invitationError || !token) throw invitationError ?? new Error('Could not create planner invitation')
      invitationLink = `${appUrl.origin}/planner-invite?token=${encodeURIComponent(String(token))}`
      recipient = email
      subject = `You are invited to plan ${workspace.name}`
      html = `<div style="font-family:Arial,sans-serif;color:#111;line-height:1.6"><h1 style="font-family:Georgia,serif;font-weight:400">Join ${escapeHtml(workspace.name)}</h1><p>You have been invited as a wedding planner. You will have access to planning information but not workspace ownership or billing controls.</p><p><a href="${escapeHtml(invitationLink)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#101828;color:#fff;text-decoration:none">Accept invitation</a></p><p>This private link expires in ${validDays} day${validDays === 1 ? '' : 's'}.</p></div>`
    }
    if (!recipient) throw new Error('The email recipient is unavailable')
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: [recipient], subject, html }),
    })
    const resendPayload = await resendResponse.json()
    if (!resendResponse.ok) {
      if (invitationLink) return new Response(JSON.stringify({ invitationLink, warning: resendPayload.message ?? 'Invitation created, but Resend rejected the email' }), { status: 207, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      throw new Error(resendPayload.message ?? 'Resend rejected the email')
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    await adminClient.from('email_delivery_logs').insert({
      workspace_id: body.workspaceId,
      notification_id: null,
      provider: 'resend',
      provider_message_id: resendPayload.id,
      recipient_email: recipient,
      subject,
      template_key: body.templateKey,
      status: 'sent',
      sent_at: new Date().toISOString(),
      provider_payload: resendPayload,
      created_by: userData.user.id,
      updated_by: userData.user.id,
    })

    return new Response(JSON.stringify({ id: resendPayload.id, invitationLink }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}
