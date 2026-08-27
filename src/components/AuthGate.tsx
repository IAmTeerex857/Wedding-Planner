import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, useLocation } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { BrandMark } from './BrandMark'

export function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  if (!isSupabaseConfigured) return children

  if (loading) {
    return (
      <main className="loading-screen">
        <BrandMark />
        <span className="loading-line" />
      </main>
    )
  }

  if (!session) return <Navigate to="/login" replace state={{ from: location }} />

  return children
}
