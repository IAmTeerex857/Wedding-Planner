import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronUpDown } from './Icon'

export type SelectOption = { value: string; label: string; disabled?: boolean }

type SelectProps = {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  /** Small prefix label rendered inside the control, for filter bars. */
  label?: ReactNode
  placeholder?: string
  disabled?: boolean
  required?: boolean
  compact?: boolean
  className?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

const GAP = 6

/**
 * A real listbox, because a native <select> always opens the operating system's
 * own menu however the closed control is styled. This renders the open state
 * too, so a dropdown looks the same on every platform and matches the rest of
 * the interface.
 *
 * The list is portalled and fixed-positioned so it escapes modal and table
 * overflow, and flips above the control when there is no room below.
 */
export function Select({
  value, onChange, options, label, placeholder = 'Select...', disabled, required,
  compact, className = '', id, ...aria
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [rect, setRect] = useState<{ top: number; left: number; width: number; flip: boolean } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ term: '', at: 0 })
  const listId = useId()

  const selected = options.find((option) => option.value === value)
  const selectedIndex = options.findIndex((option) => option.value === value)
  const firstEnabled = options.findIndex((option) => !option.disabled)
  const lastEnabled = options.findLastIndex((option) => !option.disabled)

  const position = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const box = trigger.getBoundingClientRect()
    const listHeight = listRef.current?.offsetHeight ?? Math.min(options.length * 36 + 8, 280)
    const below = window.innerHeight - box.bottom
    const flip = below < listHeight + GAP && box.top > below
    setRect({
      top: flip ? box.top - GAP : box.bottom + GAP,
      left: box.left,
      width: box.width,
      flip,
    })
  }, [options.length])

  useLayoutEffect(() => {
    if (!open) return
    position()
  }, [open, position])

  useEffect(() => {
    if (!open) return
    const onScroll = () => position()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, position])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  useEffect(() => {
    if (!open) return

    function commit(index: number) {
      const option = options[index]
      if (!option || option.disabled) return
      onChange(option.value)
      setOpen(false)
      triggerRef.current?.focus()
    }

    function onKeyDown(event: KeyboardEvent) {
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          setOpen(false)
          triggerRef.current?.focus()
          return
        case 'Tab':
          setOpen(false)
          return
        case 'ArrowDown':
        case 'ArrowUp': {
          event.preventDefault()
          const step = event.key === 'ArrowDown' ? 1 : -1
          setActiveIndex((current) => {
            let next = current
            for (let i = 0; i < options.length; i += 1) {
              next = (next + step + options.length) % options.length
              if (!options[next].disabled) return next
            }
            return current
          })
          return
        }
        case 'Home':
        case 'End':
          event.preventDefault()
          setActiveIndex(event.key === 'Home' ? firstEnabled : lastEnabled)
          return
        case 'Enter':
        case ' ':
          event.preventDefault()
          commit(activeIndex)
          return
        default:
          break
      }
      if (event.key.length !== 1) return
      const now = Date.now()
      typeahead.current.term = now - typeahead.current.at > 700 ? event.key : typeahead.current.term + event.key
      typeahead.current.at = now
      const match = options.findIndex((option) => !option.disabled && option.label.toLowerCase().startsWith(typeahead.current.term.toLowerCase()))
      if (match >= 0) setActiveIndex(match)
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, options, activeIndex, onChange, firstEnabled, lastEnabled])

  function toggle() {
    if (disabled) return
    setActiveIndex(selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : firstEnabled)
    setOpen((current) => !current)
  }

  return (
    <div className={`ui-select${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}>
      <button
        {...aria}
        className="ui-select-trigger"
        type="button"
        id={id}
        ref={triggerRef}
        disabled={disabled}
        role="combobox"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-required={required || undefined}
      >
        {label && <span className="ui-select-label">{label}</span>}
        <span className={`ui-select-value${selected ? '' : ' is-placeholder'}`}>{selected?.label ?? placeholder}</span>
        <ChevronUpDown size={16} className="ui-select-caret" />
      </button>

      {open && rect && createPortal(
        <div
          className={`ui-select-list${rect.flip ? ' is-flipped' : ''}`}
          id={listId}
          role="listbox"
          ref={listRef}
          style={{
            top: rect.flip ? undefined : rect.top,
            bottom: rect.flip ? window.innerHeight - rect.top : undefined,
            left: rect.left,
            minWidth: rect.width,
          }}
        >
          {options.map((option, index) => (
            <div
              className="ui-select-option"
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-active={index === activeIndex}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => {
                if (option.disabled) return
                onChange(option.value)
                setOpen(false)
                triggerRef.current?.focus()
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={16} className="ui-select-tick" />}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
