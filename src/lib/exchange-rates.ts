import { requireSupabase } from './supabase'

export async function fetchNgnRate(workspaceId: string, baseCurrency: string, rateDate: string) {
  if (baseCurrency === 'NGN') return { rate: 1, source: 'native' }
  const { data, error } = await requireSupabase().functions.invoke('exchange-rate', { body: { workspaceId, baseCurrency, rateDate } })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return { rate: Number(data.rate), source: String(data.source) }
}
