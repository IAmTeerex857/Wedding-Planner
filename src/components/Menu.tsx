import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'

type MenuProps = {
  /** Contents of the trigger button. */
  button: ReactNode
  buttonClassName?: string
  children: ReactNode
  align?: 'start' | 'end'
  placement?: 'top' | 'bottom'
  label: string
}

/**
 * A small roving-focus menu. Used for the sidebar "New" action and the account
 * menu, so creating a record never means navigating to a page to find a button.
 */
export function Menu({ button, buttonClassName, children, align = 'start', placement = 'bottom', label }: MenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return

    const items = () => [...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].filter((node) => !node.hasAttribute('disabled'))
    items()[0]?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (event.key === 'Tab') { setOpen(false); return }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const list = items()
      if (list.length === 0) return
      event.preventDefault()
      const index = list.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'ArrowDown' ? (index + 1) % list.length : (index - 1 + list.length) % list.length
      list[next].focus()
    }

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        className={buttonClassName}
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={id}
      >
        {button}
      </button>
      {open && (
        <div className={`menu-popover align-${align} place-${placement}`} id={id} role="menu" aria-label={label} ref={listRef}>
          <MenuCloseContext value={() => { setOpen(false); triggerRef.current?.focus() }}>{children}</MenuCloseContext>
        </div>
      )}
    </div>
  )
}

/** Closing is the menu's job, so every item dismisses it after acting. */
const MenuCloseContext = createContext<() => void>(() => {})

export function MenuItem({ icon, label, onSelect, description }: { icon?: ReactNode; label: string; onSelect: () => void; description?: string }) {
  const close = useContext(MenuCloseContext)
  return (
    <button className="menu-item" type="button" role="menuitem" onClick={() => { onSelect(); close() }}>
      {icon}
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
    </button>
  )
}
