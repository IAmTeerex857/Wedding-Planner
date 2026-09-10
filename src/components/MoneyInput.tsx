import { useId, type InputHTMLAttributes } from 'react'
import { formatAmount, parseAmount } from '../lib/amount'
import { InputGroup } from './InputGroup'

type MoneyInputProps = {
  value: string | number
  onChange: (value: string) => void
  /** Currency shown inside the control, e.g. NGN. */
  prefix?: string
  decimals?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>

/**
 * A money field that groups thousands as you type.
 *
 * `type="number"` cannot show separators, so large amounts had to be checked
 * digit by digit. This is a text input with a numeric keypad that formats the
 * display and hands back a plain number string, so nothing downstream changes.
 */
export function MoneyInput({ value, onChange, prefix, decimals = true, className = '', ...props }: MoneyInputProps) {
  const id = useId()
  return (
    <InputGroup
      {...props}
      className={className}
      id={props.id ?? id}
      prefix={prefix}
      type="text"
      inputMode={decimals ? 'decimal' : 'numeric'}
      autoComplete="off"
      value={formatAmount(value)}
      onChange={(event) => onChange(parseAmount(event.target.value))}
    />
  )
}
