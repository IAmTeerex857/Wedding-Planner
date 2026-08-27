import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) throw new Error('Authentication required')
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: userData, error: userError } = await client.auth.getUser()
    if (userError || !userData.user) throw new Error('Invalid session')
    const { workspaceId, baseCurrency, rateDate } = await request.json() as { workspaceId: string; baseCurrency: string; rateDate: string }
    if (!workspaceId || !/^[A-Z]{3}$/.test(baseCurrency) || !/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) throw new Error('Invalid rate request')
    const { data: membership } = await client.from('workspace_members').select('workspace_id').eq('workspace_id', workspaceId).eq('profile_id', userData.user.id).maybeSingle()
    if (!membership) throw new Error('Workspace access denied')
    if (baseCurrency === 'NGN') return json({ rate: 1, source: 'native', rateDate })

    const { data: existing, error: existingError } = await client.from('exchange_rates').select('rate,source,rate_date').eq('workspace_id', workspaceId).eq('base_currency', baseCurrency).eq('quote_currency', 'NGN').eq('rate_date', rateDate).is('deleted_at', null).order('retrieved_at', { ascending: false }).limit(1).maybeSingle()
    if (existingError) throw existingError
    if (existing) return json({ rate: Number(existing.rate), source: existing.source, rateDate: existing.rate_date })

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date())
    if (rateDate !== today) throw new Error('No stored historical rate exists for this date. Enter the rate manually.')
    const response = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`)
    if (!response.ok) throw new Error('Exchange-rate provider is unavailable')
    const payload = await response.json()
    const rate = Number(payload.rates?.NGN)
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`NGN rate is unavailable for ${baseCurrency}`)
    const source = 'open.er-api.com'
    const { error: insertError } = await client.from('exchange_rates').insert({ workspace_id: workspaceId, base_currency: baseCurrency, quote_currency: 'NGN', rate, rate_date: rateDate, source, retrieved_at: new Date().toISOString(), created_by: userData.user.id, updated_by: userData.user.id })
    if (insertError) throw insertError
    return json({ rate, source, rateDate })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
