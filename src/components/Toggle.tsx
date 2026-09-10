import { useId } from 'react'

type ToggleProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}

/**
 * A switch, for settings that reveal or hide something. A checkbox reads as one
 * item in a list of many; a switch reads as turning a thing on, which is what
 * these actually do.
 */
export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  const id = useId()
  return (
    <div className="ui-toggle-row">
      <button
        className="ui-toggle"
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="ui-toggle-thumb" />
      </button>
      <span className="ui-toggle-text">
        <span className="ui-toggle-label" id={id}>{label}</span>
        {description && <small>{description}</small>}
      </span>
    </div>
  )
}
