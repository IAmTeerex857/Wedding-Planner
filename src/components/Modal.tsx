import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from './Icon'

type ModalProps = {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'default' | 'wide'
  closeLabel?: string
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The single overlay used by every create and edit flow.
 *
 * Before this existed the same job was rendered four different ways — two real
 * dialogs, one bare inline form, and one inline form carrying dialog chrome but
 * no overlay, focus trap or Escape handling. It also restores focus to whatever
 * opened it, which the inline forms never did.
 */
export function Modal({ open, title, description, onClose, children, footer, size = 'default', closeLabel = 'Close' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement as HTMLElement | null

    const panel = panelRef.current
    const firstField = panel?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select')
    ;(firstField ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus()

    // The page behind must not scroll while a modal owns the view.
    const { overflow, paddingRight } = document.body.style
    const gutter = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (gutter > 0) document.body.style.paddingRight = `${gutter}px`

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // A dropdown, calendar or menu open inside the modal owns Escape first:
        // this listener runs in the capture phase, so without the check the
        // whole dialog would close instead of just the popover.
        if (document.querySelector('.ui-select-list, .ui-picker, .menu-popover')) return
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const targets = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null)
      if (targets.length === 0) return
      const first = targets[0]
      const last = targets[targets.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
      restoreTo.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="ui-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div
        className={`ui-modal-panel${size === 'wide' ? ' is-wide' : ''}`}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="ui-modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button className="ui-modal-close" type="button" onClick={onClose} aria-label={closeLabel}><X size={18} /></button>
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer && <footer className="ui-modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
