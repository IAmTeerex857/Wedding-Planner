import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (request) => {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (request.headers.get('Authorization') !== `Bearer ${serviceRoleKey}`) return response({ error: 'Unauthorized' }, 401)
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')
  if (!resendKey || !fromEmail) return response({ error: 'Email service is not configured' }, 500)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey)
  await queueWeeklySummaries(admin)
  const { data: due, error } = await admin.rpc('claim_due_notifications', { batch_size: 100 })
  if (error) return response({ error: error.message }, 500)
  let sent = 0

  for (const item of due ?? []) {
    const { data: userData } = await admin.auth.admin.getUserById(item.recipient_id)
    const recipient = userData.user?.email
    if (!recipient) { await fail(admin, item.id, 'Recipient email is unavailable'); continue }
    const resendResponse = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: fromEmail, to: [recipient], subject: item.title, html: `<div style="font-family:Arial,sans-serif;color:#111"><h1 style="font-family:Georgia,serif;font-weight:400">Timmy &amp; Bisola</h1><p>${escapeHtml(item.body)}</p></div>` }) })
    const payload = await resendResponse.json()
    if (!resendResponse.ok) { await fail(admin, item.id, payload.message ?? 'Resend rejected the email'); continue }
    await admin.from('notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', item.id)
    await admin.from('email_delivery_logs').insert({ workspace_id: item.workspace_id, notification_id: item.id, provider: 'resend', provider_message_id: payload.id, recipient_email: recipient, subject: item.title, template_key: item.notification_type, status: 'sent', sent_at: new Date().toISOString(), provider_payload: payload })
    sent += 1
  }
  return response({ processed: due?.length ?? 0, sent })
})

async function fail(admin: ReturnType<typeof createClient>, id: string, reason: string) { await admin.from('notifications').update({ status: 'failed', failure_reason: reason }).eq('id', id) }
async function queueWeeklySummaries(admin: ReturnType<typeof createClient>) {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Lagos', weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  if (part('weekday') !== 'Sun' || part('hour') !== '18') return
  const digestDate = `${part('year')}-${part('month')}-${part('day')}`
  const { data: workspaces } = await admin.from('workspaces').select('id,name').is('deleted_at', null)
  for (const workspace of workspaces ?? []) {
    const { data: existing } = await admin.from('notifications').select('id').eq('workspace_id', workspace.id).eq('notification_type', 'weekly_summary').contains('payload', { digest_date: digestDate }).limit(1).maybeSingle()
    if (existing) continue
    const [tasks, guests, expenses, requirements, members] = await Promise.all([
      admin.from('tasks').select('id,status').eq('workspace_id', workspace.id).is('deleted_at', null),
      admin.from('guests').select('id').eq('workspace_id', workspace.id).is('deleted_at', null),
      admin.from('expenses').select('ngn_minor,status').eq('workspace_id', workspace.id).is('deleted_at', null),
      admin.from('traditional_requirements').select('id,status').eq('workspace_id', workspace.id).is('deleted_at', null),
      admin.from('workspace_members').select('profile_id').eq('workspace_id', workspace.id),
    ])
    const openTasks = (tasks.data ?? []).filter((item) => item.status !== 'done').length
    const paid = (expenses.data ?? []).filter((item) => item.status === 'paid').reduce((sum, item) => sum + Number(item.ngn_minor), 0) / 100
    const outstandingRequirements = (requirements.data ?? []).filter((item) => !['approved', 'complete', 'cancelled'].includes(item.status)).length
    const body = `${openTasks} open tasks, ${(guests.data ?? []).length} guests, NGN ${paid.toLocaleString('en-NG')} paid, and ${outstandingRequirements} Traditional requirements outstanding.`
    if (members.data?.length) await admin.from('notifications').insert(members.data.map((member) => ({ workspace_id: workspace.id, recipient_id: member.profile_id, notification_type: 'weekly_summary', channel: 'email', title: `${workspace.name}: weekly planning summary`, body, status: 'scheduled', scheduled_for: now.toISOString(), payload: { digest_date: digestDate } })))
  }
}
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!) }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }
