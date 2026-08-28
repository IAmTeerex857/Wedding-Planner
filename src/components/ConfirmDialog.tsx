import { useEffect } from 'react'
import { Trash2, X } from './KoboyoIcon'

type ConfirmDialogProps = {
  title: string
  description: string
  confirmLabel?: string
  pending?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({ title, description, confirmLabel = 'Delete', pending = false, onCancel, onConfirm }: ConfirmDialogProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, pending])

  return (
    <div className="confirm-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !pending && onCancel()}>
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
        <header><span><Trash2 size={18} /></span><button type="button" aria-label="Close confirmation" disabled={pending} onClick={onCancel}><X size={16} /></button></header>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-description">{description}</p>
        <footer><button className="button secondary" type="button" disabled={pending} onClick={onCancel}>Cancel</button><button className="button danger" type="button" disabled={pending} onClick={onConfirm}>{pending ? 'Deleting...' : confirmLabel}</button></footer>
      </section>
    </div>
  )
}
