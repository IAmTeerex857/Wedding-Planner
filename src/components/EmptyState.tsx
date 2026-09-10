import type { ReactNode } from 'react'

type EmptyStateProps = {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  /** Shorter treatment for a section nested inside a page. */
  compact?: boolean
}

/**
 * The one empty state.
 *
 * Sections used to write their own: the ledger stacked an h3 and a p, the
 * allocations panel beside it laid a strong and a span out sideways. Two panels
 * on the same page, describing the same situation, in two different voices.
 */
export function EmptyState({ icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`ui-empty${compact ? ' is-compact' : ''}`}>
      {icon && <span className="ui-empty-icon">{icon}</span>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  )
}
