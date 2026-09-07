import { createContext, useContext } from 'react'

export type Workspace = {
  id: string
  name: string
  reporting_currency: string
  timezone: string
}

export type WorkspaceRole = 'owner' | 'planner'

export type WorkspaceContextValue = {
  workspace: Workspace
  userId: string
  displayName: string
  role: WorkspaceRole
  isPreview: boolean
}

export type CeremonyOption = {
  id: string
  kind: string
  name: string
}

export function ceremonyLabel(ceremony?: Pick<CeremonyOption, 'kind' | 'name'> | null) {
  if (!ceremony) return 'General / shared'
  return ceremony.name.replace(/ Wedding$/i, '') || ceremony.kind
}

export function ceremonyIdForEvent(ceremonies: CeremonyOption[], event?: string) {
  if (!event || event === 'General / shared') return null
  const normalizedEvent = event.trim().replace(/ Wedding$/i, '').toLocaleLowerCase()
  return ceremonies.find(({ id, kind, name }) => id === event || kind.trim().toLocaleLowerCase() === normalizedEvent || name.trim().replace(/ Wedding$/i, '').toLocaleLowerCase() === normalizedEvent)?.id ?? null
}

export function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return context
}
