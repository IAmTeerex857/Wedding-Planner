import type { InputHTMLAttributes, ReactNode } from 'react'

type InputGroupProps = {
  /** Leading text such as a currency or protocol, e.g. NGN or https:// */
  prefix?: ReactNode
  /** Trailing text such as a unit. */
  suffix?: ReactNode
  className?: string
} & InputHTMLAttributes<HTMLInputElement>

/**
 * A control with leading or trailing text, following Untitled UI's input group.
 *
 * The group draws the border and takes the focus ring; the input inside is
 * transparent and borderless. Previously the wrapper and the input each drew
 * their own, so focusing a money field lit a ring around the number only and
 * left the currency sitting outside it.
 *
 * The addon is separated by a hairline, so it reads as a fixed label attached
 * to the field rather than as text typed into it.
 */
export function InputGroup({ prefix, suffix, className = '', ...props }: InputGroupProps) {
  return (
    <div className={`ui-input-group${className ? ` ${className}` : ''}`}>
      {prefix && <span className="ui-input-group-addon is-prefix">{prefix}</span>}
      <input {...props} />
      {suffix && <span className="ui-input-group-addon is-suffix">{suffix}</span>}
    </div>
  )
}
