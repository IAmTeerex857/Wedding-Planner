import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut, MailCheck, UserPlus } from '../components/KoboyoIcon'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import './settings.css'

export function SettingsPage() {
  const { workspace, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const [name, setName] = useState(workspace.name)
  const [currency, setCurrency] = useState(workspace.reporting_currency)
  const [partnerEmail, setPartnerEmail] = useState('')

  const membersQuery = useQuery({
    queryKey: ['workspace-members', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const { data, error } = await supabase!.from('workspace_members').select('profile_id,created_at').eq('workspace_id', workspace.id)
      if (error) throw error
      return data
    },
  })
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isPreview) return
      const { error } = await supabase!.from('workspaces').update({ name: name.trim(), reporting_currency: currency }).eq('id', workspace.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['active-workspace'] }),
  })
  const ownerMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase!.rpc('add_workspace_owner_by_email', { target_workspace_id: workspace.id, owner_email: email })
      if (error) throw error
    },
    onSuccess: () => { setPartnerEmail(''); void queryClient.invalidateQueries({ queryKey: ['workspace-members', workspace.id] }) },
  })
  const emailTestMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase!.functions.invoke('send-notification', {
        body: { workspaceId: workspace.id, templateKey: 'connection_test' },
      })
      if (error) throw error
    },
  })

  function addOwner(event: FormEvent) {
    event.preventDefault()
    if (partnerEmail.trim()) ownerMutation.mutate(partnerEmail.trim())
  }

  return <div className="page settings-page ui-page">
    <header className="page-header"><div><p className="eyebrow">Workspace control</p><h1>Settings</h1><p className="page-lead">Manage shared defaults, both owner accounts, and session security.</p></div></header>
    <section className="settings-section"><header><div><p className="eyebrow">General</p><h2>Wedding office</h2></div></header><div className="settings-fields"><label>Workspace name<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Reporting currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>NGN</option><option>GBP</option><option>USD</option><option>EUR</option></select></label><label>Timezone<input value="Africa/Lagos" readOnly /></label><label>Weekly summary<input value="Sunday evening" readOnly /></label></div><footer>{saveMutation.error && <span>{saveMutation.error.message}</span>}<button className="button primary" type="button" disabled={saveMutation.isPending || name.trim().length < 2} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? 'Saving...' : 'Save settings'}</button></footer></section>
    <section className="settings-section"><header><div><p className="eyebrow">Private access</p><h2>Workspace owners</h2></div><span>{membersQuery.data?.length ?? (isPreview ? 2 : 0)} / 2 owners</span></header><form className="owner-form" onSubmit={addOwner}><div><strong>Add the second owner</strong><p>Create their Supabase Authentication user first, then enter the same email here.</p></div><input type="email" required maxLength={254} value={partnerEmail} onChange={(event) => setPartnerEmail(event.target.value)} placeholder="owner@example.com" disabled={(membersQuery.data?.length ?? 0) >= 2} /><button className="button secondary" type="submit" disabled={isPreview || ownerMutation.isPending || !partnerEmail.trim()}><UserPlus size={15} /> Add owner</button></form>{ownerMutation.error && <p className="settings-error">{ownerMutation.error.message}</p>}{ownerMutation.isSuccess && <p className="settings-success">The second owner now has access to this workspace.</p>}</section>
    <section className="settings-section"><header><div><p className="eyebrow">Email delivery</p><h2>Resend connection</h2></div></header><div className="email-test"><div><strong>Send a private test</strong><p>The message will be sent to the currently signed-in owner's email.</p></div><button className="button secondary" type="button" disabled={isPreview || emailTestMutation.isPending} onClick={() => emailTestMutation.mutate()}><MailCheck size={15} /> {emailTestMutation.isPending ? 'Sending...' : 'Send test email'}</button></div>{emailTestMutation.error && <p className="settings-error">{emailTestMutation.error.message}</p>}{emailTestMutation.isSuccess && <p className="settings-success">Test email accepted by Resend.</p>}</section>
    <section className="settings-section danger-zone"><header><div><p className="eyebrow">Current session</p><h2>Sign out</h2></div></header><div><p>End this session on the current device. Your wedding information remains in Supabase.</p><button className="button secondary" type="button" disabled={isPreview} onClick={() => supabase?.auth.signOut()}><LogOut size={15} /> Sign out</button></div></section>
  </div>
}
