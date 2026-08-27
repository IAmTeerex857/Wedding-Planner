import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { WorkspaceContext, type Workspace, type WorkspaceContextValue } from '../lib/workspace-context'
import { WorkspaceOnboarding } from '../pages/WorkspaceOnboarding'
import { BrandMark } from './BrandMark'

const previewWorkspace: WorkspaceContextValue = {
  workspace: {
    id: 'preview',
    name: 'Timmy & Bisola',
    reporting_currency: 'NGN',
    timezone: 'Africa/Lagos',
  },
  userId: 'preview',
  displayName: 'Timmy & Bisola',
  isPreview: true,
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const workspaceQuery = useQuery({
    queryKey: ['active-workspace'],
    enabled: isSupabaseConfigured,
    queryFn: loadWorkspace,
  })

  const createWorkspace = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase!.rpc('create_wedding_workspace', { workspace_name: name })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['active-workspace'] }),
  })

  if (!isSupabaseConfigured) {
    return <WorkspaceContext.Provider value={previewWorkspace}>{children}</WorkspaceContext.Provider>
  }

  if (workspaceQuery.isLoading) {
    return <main className="loading-screen"><BrandMark /><span className="loading-line" /></main>
  }

  if (workspaceQuery.error) {
    return (
      <main className="system-message">
        <BrandMark />
        <div><p className="eyebrow">Connection error</p><h1>We could not open the workspace.</h1><p>{workspaceQuery.error.message}</p></div>
        <button className="button primary" type="button" onClick={() => workspaceQuery.refetch()}>Try again</button>
      </main>
    )
  }

  const workspaceData = workspaceQuery.data

  if (!workspaceData?.workspace) {
    return <WorkspaceOnboarding loading={createWorkspace.isPending} error={createWorkspace.error?.message} onCreate={(name) => createWorkspace.mutate(name)} />
  }

  return <WorkspaceContext.Provider value={{ ...workspaceData, workspace: workspaceData.workspace, isPreview: false }}>{children}</WorkspaceContext.Provider>
}

async function loadWorkspace(): Promise<{ workspace: Workspace | null; userId: string; displayName: string }> {
  const { data: userData, error: userError } = await supabase!.auth.getUser()
  if (userError || !userData.user) throw userError ?? new Error('No authenticated user')

  const [{ data: profile }, { data: membership, error: membershipError }] = await Promise.all([
    supabase!.from('profiles').select('display_name').eq('id', userData.user.id).maybeSingle(),
    supabase!.from('workspace_members').select('workspace_id').eq('profile_id', userData.user.id).limit(1).maybeSingle(),
  ])

  if (membershipError) throw membershipError
  if (!membership) {
    return { workspace: null, userId: userData.user.id, displayName: profile?.display_name ?? userData.user.email ?? 'Owner' }
  }

  const { data: workspace, error: workspaceError } = await supabase!
    .from('workspaces')
    .select('id,name,reporting_currency,timezone')
    .eq('id', membership.workspace_id)
    .is('deleted_at', null)
    .single()
  if (workspaceError) throw workspaceError

  return {
    workspace,
    userId: userData.user.id,
    displayName: profile?.display_name ?? userData.user.email ?? 'Owner',
  }
}
