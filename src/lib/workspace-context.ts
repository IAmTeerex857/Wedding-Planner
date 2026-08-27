import { createContext, useContext } from 'react'

export type Workspace = {
  id: string
  name: string
  reporting_currency: string
  timezone: string
}

export type WorkspaceContextValue = {
  workspace: Workspace
  userId: string
  displayName: string
  isPreview: boolean
}

export type CeremonyOption = {
  id: string
  kind: string
  name: string
}

export function ceremonyLabel(ceremony?: Pick<CeremonyOption, 'kind' | 'name'> | null) {
  if (!ceremony) return 'General / shared'
  return ceremony.kind ? `${ceremony.kind[0].toUpperCase()}${ceremony.kind.slice(1)}` : ceremony.name.replace(/ Wedding$/i, '')
}

export function ceremonyIdForEvent(ceremonies: CeremonyOption[], event?: string) {
  if (!event || event === 'General / shared') return null
  return ceremonies.find(({ kind, name }) => kind === event.toLocaleLowerCase() || name.replace(/ Wedding$/i, '').toLocaleLowerCase() === event.toLocaleLowerCase())?.id ?? null
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
