import { useEffect, useRef, useState, type RefObject } from 'react'

const TRACK = 200 // px, matches the .fsb height in index.css
const MIN_THUMB = 28
const IDLE_MS = 1100

/** Scroll metrics for a container, or the page when there is none. */
function readMetrics(element: HTMLElement | null) {
  if (element) return { top: element.scrollTop, viewport: element.clientHeight, total: element.scrollHeight }
  return { top: window.scrollY, viewport: window.innerHeight, total: document.documentElement.scrollHeight }
}

type FloatingScrollbarProps = {
  /**
   * The element to scroll. Omit to drive the page itself.
   * When given, the bar positions itself inside that element's offset parent,
   * so a panel gets the same control the page has rather than a native bar.
   */
  container?: RefObject<HTMLElement | null>
  className?: string
}

/**
 * The app's scrollbar. The native one is hidden wherever this is used.
 *
 * It drives the document by default, and any scroll container when handed one,
 * so a new scrolling surface never has to grow a bar of its own.
 */
export function FloatingScrollbar({ container, className = '' }: FloatingScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState({ y: 0, h: MIN_THUMB, scrollable: false })
  const [active, setActive] = useState(false)
  const hover = useRef(false)
  const idle = useRef(0)
  const wakeRef = useRef(() => {})

  useEffect(() => {
    const element = container?.current ?? null
    const target: HTMLElement | Window = element ?? window

    const update = () => {
      const { top, viewport, total } = readMetrics(element)
      const max = total - viewport
      const h = Math.max(MIN_THUMB, Math.round(TRACK * Math.min(1, viewport / total)))
      const y = max > 0 ? Math.round((TRACK - h) * Math.min(1, top / max)) : 0
      setThumb({ y, h, scrollable: max > 1 })
    }

    const wake = () => {
      setActive(true)
      window.clearTimeout(idle.current)
      idle.current = window.setTimeout(() => { if (!hover.current) setActive(false) }, IDLE_MS)
    }
    wakeRef.current = wake

    const first = requestAnimationFrame(update)
    const onScroll = () => { update(); wake() }
    target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', update)
    // Route changes and expanding panels change height without scrolling.
    const observer = new ResizeObserver(update)
    observer.observe(element ?? document.body)
    if (element) for (const child of Array.from(element.children)) observer.observe(child)
    return () => {
      cancelAnimationFrame(first)
      window.clearTimeout(idle.current)
      target.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', update)
      observer.disconnect()
    }
  }, [container])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current
    if (!track) return
    event.preventDefault()
    const rect = track.getBoundingClientRect()
    const { viewport, total } = readMetrics(container?.current ?? null)
    const max = total - viewport
    const range = TRACK - thumb.h
    const onThumb = event.clientY >= rect.top + thumb.y && event.clientY <= rect.top + thumb.y + thumb.h
    const grab = onThumb ? event.clientY - (rect.top + thumb.y) : thumb.h / 2
    const to = (clientY: number, smooth: boolean) => {
      const y = Math.min(range, Math.max(0, clientY - rect.top - grab))
      const top = (y / range) * max
      const element = container?.current
      if (element) element.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
      else window.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
    }
    if (!onThumb) to(event.clientY, true)
    track.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => { to(moveEvent.clientY, false); wakeRef.current() }
    const up = () => {
      track.removeEventListener('pointermove', move)
      track.removeEventListener('pointerup', up)
    }
    track.addEventListener('pointermove', move)
    track.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={trackRef}
      className={`fsb${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      hidden={!thumb.scrollable}
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerEnter={() => { hover.current = true; setActive(true) }}
      onPointerLeave={() => { hover.current = false; wakeRef.current() }}
    >
      <div className="fsb-thumb" style={{ height: thumb.h, transform: `translateY(${thumb.y}px)` }} />
    </div>
  )
}
