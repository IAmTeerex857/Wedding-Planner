import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Select } from '../components/Select'
import { Check, LogOut, Mail, MailCheck, Trash2, UserPlus, Users } from '../components/Icon'
import { BrandMark } from '../components/BrandMark'
import { ACTIVE_WORKSPACE_KEY } from '../components/WorkspaceProvider'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import './settings.css'

type Member = { profile_id: string; role: 'owner' | 'planner'; created_at: string }
type Invitation = { id: string; email: string; status: 'pending' | 'accepted' | 'revoked' | 'expired'; expires_at: string; accepted_by: string | null; created_at: string }

function readableDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function SettingsPage() {
  const { workspace, userId, displayName, role, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const isOwner = role === 'owner'
  const [name, setName] = useState(workspace.name)
  const [currency, setCurrency] = useState(workspace.reporting_currency)
  const [partnerEmail, setPartnerEmail] = useState('')
  const [plannerEmail, setPlannerEmail] = useState('')
  const [validDays, setValidDays] = useState('7')
  const [invitationLink, setInvitationLink] = useState('')
  const [copyStatus, setCopyStatus] = useState('')

  const membersQuery = useQuery({
    queryKey: ['workspace-members', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const { data, error } = await supabase!.from('workspace_members').select('profile_id,role,created_at').eq('workspace_id', workspace.id).order('created_at')
      if (error) throw error
      return data as Member[]
    },
  })
  const invitationsQuery = useQuery({
    queryKey: ['workspace-invitations', workspace.id],
    enabled: !isPreview && isOwner,
    queryFn: async () => {
      const { data, error } = await supabase!.from('workspace_invitations').select('id,email,status,expires_at,accepted_by,created_at').eq('workspace_id', workspace.id).order('created_at', { ascending: false })
      if (error) throw error
      return data as Invitation[]
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
  const inviteMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase!.functions.invoke('send-notification', {
        body: {
          workspaceId: workspace.id,
          templateKey: 'planner_invitation',
          email: plannerEmail.trim(),
          validDays: Number(validDays),
          appUrl: window.location.origin,
        },
      })
      if (error) throw error
      return data as { invitationLink: string; warning?: string }
    },
    onSuccess: ({ invitationLink: link, warning }) => {
      setInvitationLink(link)
      setPlannerEmail('')
      setCopyStatus(warning ?? 'Email sent')
      void queryClient.invalidateQueries({ queryKey: ['workspace-invitations', workspace.id] })
    },
  })
  const revokeMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await supabase!.rpc('revoke_workspace_planner_invitation', { invitation_id: invitationId })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace-invitations', workspace.id] }),
  })
  const removeMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const { error } = await supabase!.rpc('remove_workspace_planner', { target_workspace_id: workspace.id, planner_profile_id: profileId })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace-members', workspace.id] }),
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

  function invitePlanner(event: FormEvent) {
    event.preventDefault()
    if (plannerEmail.trim()) inviteMutation.mutate()
  }

  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(invitationLink)
      setCopyStatus('Copied')
    } catch {
      setCopyStatus('Could not copy automatically. Select and copy the link.')
    }
  }

  const members = membersQuery.data ?? (isPreview ? [
    { profile_id: userId, role: 'owner' as const, created_at: new Date().toISOString() },
    { profile_id: 'preview-partner', role: 'owner' as const, created_at: new Date().toISOString() },
  ] : [])
  const ownerCount = members.filter((member) => member.role === 'owner').length
  const invitations = invitationsQuery.data ?? []
  const pendingInvitations = invitations.filter((invitation) => invitation.status === 'pending')
  const acceptedEmails = new Map(invitations.filter((invitation) => invitation.accepted_by).map((invitation) => [invitation.accepted_by, invitation.email]))

  return <div className="page settings-page ui-page">
    <header className="page-header"><div><h1>Settings</h1><p className="page-lead">{isOwner ? 'Manage shared defaults, workspace access, and session security.' : 'Review your planner access and session security.'}</p></div></header>
    <section className="settings-section"><header><div><p className="eyebrow">General</p><h2>Wedding office</h2></div>{!isOwner && <span>Owner managed</span>}</header><div className="settings-fields"><label>Workspace name<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} disabled={!isOwner} /></label><label>Reporting currency<Select aria-label="Reporting currency" value={currency} onChange={setCurrency} disabled={!isOwner} options={[{ value: 'NGN', label: 'NGN' }, { value: 'GBP', label: 'GBP' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }]} /></label><label>Timezone<input value="Africa/Lagos" readOnly /></label><label>Weekly summary<input value="Sunday evening" readOnly /></label></div>{isOwner && <footer>{saveMutation.error && <span>{saveMutation.error.message}</span>}<button className="button primary" type="button" disabled={isPreview || saveMutation.isPending || name.trim().length < 2} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? 'Saving...' : 'Save settings'}</button></footer>}</section>
    {isOwner && <section className="settings-section"><header><div><p className="eyebrow">Private access</p><h2>Workspace owners</h2></div><span>{isPreview ? 2 : ownerCount} / 2 owners</span></header><form className="owner-form" onSubmit={addOwner}><div><strong>Add the second owner</strong><p>Create their Supabase Authentication user first, then enter the same email here.</p></div><input type="email" required maxLength={254} value={partnerEmail} onChange={(event) => setPartnerEmail(event.target.value)} placeholder="owner@example.com" disabled={ownerCount >= 2} /><button className="button secondary" type="submit" disabled={isPreview || ownerMutation.isPending || !partnerEmail.trim() || ownerCount >= 2}><UserPlus size={15} /> Add owner</button></form>{ownerMutation.error && <p className="settings-error">{ownerMutation.error.message}</p>}{ownerMutation.isSuccess && <p className="settings-success">The second owner now has access to this workspace.</p>}</section>}
    {isOwner && <section className="settings-section"><header><div><p className="eyebrow">Planning access</p><h2>Invite a wedding planner</h2></div><span>Owner only</span></header><form className="planner-invite-form" onSubmit={invitePlanner}><label><span>Planner email</span><input type="email" required maxLength={320} value={plannerEmail} onChange={(event) => setPlannerEmail(event.target.value)} placeholder="planner@example.com" /></label><label><span>Link expires</span><Select aria-label="Invitation expiry" value={validDays} onChange={setValidDays} options={[{ value: '1', label: 'In 1 day' }, { value: '7', label: 'In 7 days' }, { value: '14', label: 'In 14 days' }, { value: '30', label: 'In 30 days' }]} /></label><button className="button primary" type="submit" disabled={isPreview || inviteMutation.isPending || !plannerEmail.trim()}><Mail size={15} /> {inviteMutation.isPending ? 'Sending...' : 'Send invitation'}</button></form><p className="delivery-note">The planner receives a private, single-use invitation link by email. You can also copy the new link below.</p>{inviteMutation.error && <p className="settings-error">{inviteMutation.error.message}</p>}{invitationLink && <div className="invitation-link"><label><span>New invitation link</span><input value={invitationLink} readOnly onFocus={(event) => event.target.select()} /></label><button className="button secondary" type="button" onClick={copyInvitation}><Check size={15} /> {copyStatus === 'Copied' ? 'Copied' : 'Copy link'}</button>{copyStatus && copyStatus !== 'Copied' && <p className={copyStatus === 'Email sent' ? 'settings-success' : 'settings-error'}>{copyStatus}</p>}</div>}</section>}
    {isOwner && <section className="settings-section"><header><div><p className="eyebrow">Open invitations</p><h2>Pending planner invitations</h2></div><span>{pendingInvitations.length} pending</span></header>{invitationsQuery.isLoading ? <p className="settings-empty">Loading invitations...</p> : pendingInvitations.length ? <div className="access-list">{pendingInvitations.map((invitation) => { const expired = new Date(invitation.expires_at) <= new Date(); return <article key={invitation.id}><span className="access-icon"><Mail size={16} /></span><div><strong>{invitation.email}</strong><p>{expired ? 'Expired' : `Expires ${readableDate(invitation.expires_at)}`}</p></div><span className={`role-badge${expired ? ' is-expired' : ''}`}>{expired ? 'Expired' : 'Pending'}</span><button className="button secondary danger-button" type="button" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate(invitation.id)}>Revoke</button></article> })}</div> : <p className="settings-empty">No pending planner invitations.</p>}{invitationsQuery.error && <p className="settings-error">{invitationsQuery.error.message}</p>}{revokeMutation.error && <p className="settings-error">{revokeMutation.error.message}</p>}</section>}
    <section className="settings-section"><header><div><p className="eyebrow">People</p><h2>Workspace members</h2></div><span>{members.length || (isPreview ? 2 : 0)} members</span></header>{membersQuery.isLoading ? <p className="settings-empty">Loading members...</p> : <div className="access-list">{members.map((member) => <article key={member.profile_id}><span className="access-icon"><Users size={16} /></span><div><strong>{member.profile_id === userId ? displayName : acceptedEmails.get(member.profile_id) ?? (member.role === 'owner' ? 'Workspace owner' : 'Wedding planner')}</strong><p>{member.profile_id === userId ? 'You' : `Member ${member.profile_id.slice(0, 8)}`}</p></div><span className="role-badge">{member.role}</span>{isOwner && member.role === 'planner' && <button className="button secondary danger-button" type="button" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate(member.profile_id)}><Trash2 size={14} /> Remove</button>}</article>)}</div>}{membersQuery.error && <p className="settings-error">{membersQuery.error.message}</p>}{removeMutation.error && <p className="settings-error">{removeMutation.error.message}</p>}</section>
    {isOwner && <section className="settings-section"><header><div><p className="eyebrow">Email delivery</p><h2>Resend connection</h2></div></header><div className="email-test"><div><strong>Send a private test</strong><p>The message will be sent to the currently signed-in owner's email.</p></div><button className="button secondary" type="button" disabled={isPreview || emailTestMutation.isPending} onClick={() => emailTestMutation.mutate()}><MailCheck size={15} /> {emailTestMutation.isPending ? 'Sending...' : 'Send test email'}</button></div>{emailTestMutation.error && <p className="settings-error">{emailTestMutation.error.message}</p>}{emailTestMutation.isSuccess && <p className="settings-success">Test email accepted by Resend.</p>}</section>}
    <section className="settings-section danger-zone"><header><div><p className="eyebrow">Current session</p><h2>Sign out</h2></div></header><div><p>End this session on the current device. Your wedding information remains in Supabase.</p><button className="button secondary" type="button" disabled={isPreview} onClick={() => supabase?.auth.signOut()}><LogOut size={15} /> Sign out</button></div></section>
  </div>
}

export function PlannerInvitationPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const token = searchParams.get('token')?.trim() ?? ''
  const userQuery = useQuery({
    queryKey: ['invitation-user'],
    queryFn: async () => {
      const { data, error } = await supabase!.auth.getUser()
      if (error) throw error
      return data.user
    },
  })
  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error('This invitation link is missing its token.')
      const { data, error } = await supabase!.rpc('accept_workspace_planner_invitation', { invitation_token: token })
      if (error) throw error
      return data as string
    },
    onSuccess: async (workspaceId) => {
      window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId)
      await queryClient.invalidateQueries({ queryKey: ['active-workspace'] })
      navigate('/', { replace: true })
    },
  })

  return <main className="planner-invitation-page ui-auth-page"><section><BrandMark /><div><h1>Join the planning workspace</h1><p>Accepting adds you as a planner with access to the wedding planning tools. Workspace ownership and access controls remain private to the owners.</p></div>{userQuery.data?.email && <p className="invitation-account">Signed in as <strong>{userQuery.data.email}</strong>. The invitation must match this email.</p>}{!token && <p className="form-error">This invitation link is incomplete. Ask the workspace owner for a new link.</p>}{acceptMutation.error && <p className="form-error">{acceptMutation.error.message}</p>}<div className="invitation-actions"><button className="button primary" type="button" disabled={!token || acceptMutation.isPending} onClick={() => acceptMutation.mutate()}>{acceptMutation.isPending ? 'Joining...' : 'Accept invitation'}</button><button className="button secondary" type="button" onClick={() => supabase?.auth.signOut()}>Use another account</button></div></section></main>
}
