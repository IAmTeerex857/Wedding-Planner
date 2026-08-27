import { useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/BrandMark'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!isSupabaseConfigured) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const { error: signInError } = await supabase!.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (signInError) {
      setError(signInError.message)
      return
    }
    navigate('/')
  }

  return (
    <main className="login-page">
      <section className="login-intro">
        <BrandMark />
        <div>
          <p className="eyebrow">Private planning space</p>
          <h1>One place for every part of the celebration.</h1>
          <p>Court. Traditional. White. Planned together, without the spreadsheet.</p>
        </div>
        <p className="login-footnote">For Timmy and Bisola only.</p>
      </section>
      <section className="login-panel">
        <form className="login-form" onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Welcome back</p>
            <h2>Sign in</h2>
            <p>Use your private wedding planner account.</p>
          </div>
          <label>
            Email address
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="button primary full" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Continue'} <ArrowRight size={16} />
          </button>
        </form>
      </section>
    </main>
  )
}
