import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Square, label-free button. Requires aria-label. */
  icon?: boolean
  fullWidth?: boolean
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

/**
 * The only button in the app.
 *
 * Every surface used to reach for its own: `.text-action` on an empty state,
 * `.plain-icon-button` in a table row, `.budget-icon-button` in the ledger,
 * `.danger-button` in settings. They drifted in weight, size and radius, so an
 * empty-state button looked nothing like the one beside it. Change a button
 * here and it changes everywhere.
 */
export function Button({ variant = 'secondary', size = 'md', icon = false, fullWidth = false, type = 'button', className = '', children, ...props }: ButtonProps) {
  const classes = ['button', variant, size === 'sm' && 'compact', icon && 'is-icon', fullWidth && 'full', className]
    .filter(Boolean)
    .join(' ')
  return <button {...props} className={classes} type={type}>{children}</button>
}
