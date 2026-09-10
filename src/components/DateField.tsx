import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronRight, Clock3 } from './Icon'

const GAP = 6
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/** Local ISO date (yyyy-mm-dd) without the UTC shift `toISOString()` introduces. */
function toISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseISO(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Monday-first grid covering the weeks that contain the given month. */
function monthGrid(view: Date) {
  const first = new Date(view.getFullYear(), view.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

function usePopover(open: boolean, triggerRef: React.RefObject<HTMLButtonElement | null>, panelRef: React.RefObject<HTMLDivElement | null>) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; flip: boolean } | null>(null)

  const position = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const box = trigger.getBoundingClientRect()
    const height = panelRef.current?.offsetHeight ?? 320
    const below = window.innerHeight - box.bottom
    const flip = below < height + GAP && box.top > below
    const width = panelRef.current?.offsetWidth ?? 300
    setRect({
      top: flip ? box.top - GAP : box.bottom + GAP,
      left: Math.min(box.left, window.innerWidth - width - 12),
      width: box.width,
      flip,
    })
  }, [triggerRef, panelRef])

  useLayoutEffect(() => { if (open) position() }, [open, position])
  useEffect(() => {
    if (!open) return
    const handler = () => position()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [open, position])

  return rect
}

function useDismiss(open: boolean, close: () => void, triggerRef: React.RefObject<HTMLElement | null>, panelRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' || event.key === 'Tab') close()
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, close, triggerRef, panelRef])
}

type DateFieldProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
  id?: string
  className?: string
  'aria-label'?: string
}

/**
 * A calendar the app draws itself. `<input type="date">` renders a browser
 * placeholder and a platform picker, which read as unstyled next to everything
 * else and, under lang="en", showed dates in US order.
 */
export function DateField({ value, onChange, placeholder = 'Select date', disabled, required, id, className = '', ...aria }: DateFieldProps) {
  const [open, setOpen] = useState(false)
  const selected = parseISO(value)
  const [view, setView] = useState(() => selected ?? new Date())
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const rect = usePopover(open, triggerRef, panelRef)

  const close = useCallback(() => { setOpen(false); triggerRef.current?.focus() }, [])
  useDismiss(open, close, triggerRef, panelRef)

  const today = toISO(new Date())
  const days = monthGrid(view)

  return (
    <div className={`ui-datefield${className ? ` ${className}` : ''}`}>
      <button
        {...aria}
        className="ui-select-trigger"
        type="button"
        id={id}
        ref={triggerRef}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-required={required || undefined}
        onClick={() => {
          if (!open && selected) setView(selected)
          setOpen((current) => !current)
        }}
      >
        <span className={`ui-select-value${selected ? '' : ' is-placeholder'}`}>
          {selected ? new Intl.DateTimeFormat('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }).format(selected) : placeholder}
        </span>
        <CalendarDays size={16} className="ui-select-caret" />
      </button>

      {open && rect && createPortal(
        <div
          className="ui-picker"
          ref={panelRef}
          role="dialog"
          aria-label="Choose date"
          style={{ top: rect.flip ? undefined : rect.top, bottom: rect.flip ? window.innerHeight - rect.top : undefined, left: rect.left }}
        >
          <div className="ui-picker-head">
            <button type="button" aria-label="Previous month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>
              <ChevronRight size={16} className="is-flipped" />
            </button>
            <strong>{new Intl.DateTimeFormat('en-NG', { month: 'long', year: 'numeric' }).format(view)}</strong>
            <button type="button" aria-label="Next month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="ui-picker-weekdays" aria-hidden="true">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="ui-picker-grid">
            {days.map((day) => {
              const iso = toISO(day)
              return (
                <button
                  className="ui-picker-day"
                  key={iso}
                  type="button"
                  data-outside={day.getMonth() !== view.getMonth() || undefined}
                  data-today={iso === today || undefined}
                  aria-pressed={iso === value}
                  onClick={() => { onChange(iso); close() }}
                >
                  {day.getDate()}
                </button>
              )
            })}
          </div>
          <div className="ui-picker-foot">
            <button type="button" onClick={() => { onChange(today); close() }}>Today</button>
            {value && <button type="button" onClick={() => { onChange(''); close() }}>Clear</button>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

type TimeFieldProps = Omit<DateFieldProps, 'placeholder'> & { placeholder?: string; step?: number }

/** Times on a fixed grid, shown in the app's own list rather than a platform spinner. */
export function TimeField({ value, onChange, placeholder = 'Time', disabled, id, className = '', step = 15, ...aria }: TimeFieldProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const rect = usePopover(open, triggerRef, panelRef)
  const close = useCallback(() => { setOpen(false); triggerRef.current?.focus() }, [])
  useDismiss(open, close, triggerRef, panelRef)

  const times = Array.from({ length: Math.floor((24 * 60) / step) }, (_, index) => {
    const minutes = index * step
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  })

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'center' })
  }, [open])

  return (
    <div className={`ui-datefield${className ? ` ${className}` : ''}`}>
      <button
        {...aria}
        className="ui-select-trigger"
        type="button"
        id={id}
        ref={triggerRef}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`ui-select-value${value ? '' : ' is-placeholder'}`}>{value || placeholder}</span>
        <Clock3 size={16} className="ui-select-caret" />
      </button>

      {open && rect && createPortal(
        <div
          className="ui-select-list ui-timelist"
          ref={panelRef}
          role="listbox"
          aria-label="Choose time"
          style={{ top: rect.flip ? undefined : rect.top, bottom: rect.flip ? window.innerHeight - rect.top : undefined, left: rect.left, width: rect.width }}
        >
          {times.map((time) => (
            <button
              className="ui-select-option"
              key={time}
              type="button"
              role="option"
              aria-selected={time === value}
              aria-pressed={time === value}
              onClick={() => { onChange(time); close() }}
            >
              <span>{time}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

/**
 * Composes the two controls above for `datetime-local` values, which the task
 * form uses for due dates and reminders.
 */
export function DateTimeField({ value, onChange, disabled, id, className = '', ...aria }: Omit<DateFieldProps, 'placeholder'>) {
  const [datePart = '', timePart = ''] = value ? value.split('T') : []

  function emit(nextDate: string, nextTime: string) {
    if (!nextDate) return onChange('')
    onChange(`${nextDate}T${nextTime || '09:00'}`)
  }

  return (
    <div className={`ui-datetime${className ? ` ${className}` : ''}`}>
      <DateField
        {...aria}
        id={id}
        value={datePart}
        disabled={disabled}
        onChange={(next) => emit(next, timePart)}
      />
      <TimeField
        value={timePart}
        disabled={disabled || !datePart}
        aria-label="Time"
        onChange={(next) => emit(datePart, next)}
      />
    </div>
  )
}
