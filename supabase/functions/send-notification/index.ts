import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type SendRequest = {
  workspaceId: string
  templateKey: 'connection_test'
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
    if (!body.workspaceId || body.templateKey !== 'connection_test') throw new Error('Unsupported email request')

    const { data: membership, error: membershipError } = await userClient
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', body.workspaceId)
      .eq('profile_id', userData.user.id)
      .maybeSingle()
    if (membershipError || !membership) throw new Error('Workspace access denied')

    const recipient = userData.user.email
    if (!recipient) throw new Error('The current owner has no email address')
    const subject = 'Your wedding office is connected'
    const html = '<div style="font-family:Arial,sans-serif;color:#111"><h1 style="font-family:Georgia,serif;font-weight:400">Timmy &amp; Bisola</h1><p>Resend is connected to your private wedding office.</p></div>'
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: [recipient], subject, html }),
    })
    const resendPayload = await resendResponse.json()
    if (!resendResponse.ok) throw new Error(resendPayload.message ?? 'Resend rejected the email')

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

    return new Response(JSON.stringify({ id: resendPayload.id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
