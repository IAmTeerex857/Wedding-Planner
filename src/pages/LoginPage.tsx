import { useState, type FormEvent } from 'react'
import { ArrowRight } from '../components/Icon'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/BrandMark'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { Button } from '../components/Button'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [creatingAccount, setCreatingAccount] = useState(false)

  if (!isSupabaseConfigured) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')
    const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from
    const returnPath = from?.pathname ? `${from.pathname}${from.search ?? ''}` : '/'
    if (creatingAccount) {
      const { data, error: signUpError } = await supabase!.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}${returnPath}`, data: { display_name: email.split('@')[0] } },
      })
      setLoading(false)
      if (signUpError) { setError(signUpError.message); return }
      if (!data.session) { setNotice('Check your email to confirm your account, then return to the invitation link.'); return }
      navigate(returnPath, { replace: true })
      return
    }
    const { error: signInError } = await supabase!.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (signInError) {
      setError(signInError.message)
      return
    }
    navigate(returnPath, { replace: true })
  }

  return (
    <main className="login-page ui-auth-page">
      <section className="login-intro">
        <BrandMark />
        <div>
          <p className="eyebrow">Private planning space</p>
          <h1>One place for every part of the celebration.</h1>
          <p>Every ceremony planned together, without the spreadsheet.</p>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-form" onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">{creatingAccount ? 'Planner invitation' : 'Welcome back'}</p>
            <h2>{creatingAccount ? 'Create an account' : 'Sign in'}</h2>
            <p>{creatingAccount ? 'Create your private account, then accept the planner invitation.' : 'Use your private wedding planner account.'}</p>
          </div>
          <label>
            Email address
            <input type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {error && <p className="form-error">{error}</p>}
          {notice && <p className="form-success">{notice}</p>}
          <Button variant="primary" fullWidth type="submit" disabled={loading}>
            {loading ? creatingAccount ? 'Creating account...' : 'Signing in...' : creatingAccount ? 'Create account' : 'Continue'} <ArrowRight size={16} />
          </Button>
          <Button variant="secondary" fullWidth type="button" disabled={loading} onClick={() => { setCreatingAccount((current) => !current); setError(''); setNotice('') }}>{creatingAccount ? 'I already have an account' : 'Create a planner account'}</Button>
        </form>
      </section>
    </main>
  )
}
