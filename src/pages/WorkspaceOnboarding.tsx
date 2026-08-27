import { useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { BrandMark } from '../components/BrandMark'

export function WorkspaceOnboarding({ loading, error, onCreate }: {
  loading: boolean
  error?: string
  onCreate: (name: string) => void
}) {
  const [name, setName] = useState('Timmy & Bisola')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (name.trim()) onCreate(name.trim())
  }

  return (
    <main className="onboarding-page">
      <header><BrandMark /><span>Private workspace setup</span></header>
      <form onSubmit={submit}>
        <p className="eyebrow">One final step</p>
        <h1>Create your wedding office.</h1>
        <p>This creates the shared space and adds Court, Traditional, and White as the three ceremonies.</p>
        <label>
          Workspace name
          <input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} required />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="button primary" type="submit" disabled={loading || !name.trim()}>
          {loading ? 'Creating workspace...' : 'Create workspace'} <ArrowRight size={16} />
        </button>
      </form>
    </main>
  )
}
