import { useCallback, useEffect, useRef, useState } from 'react'

const TRACK = 200 // px, matches the .fsb height in index.css
const MIN_THUMB = 28
const IDLE_MS = 1100

/**
 * Replaces the browser scrollbar on the document. The native bar is hidden in
 * index.css; this is the visible one. Scroll containers that are not the page
 * itself (the sidebar rail, the assistant panel) keep their own styled bars.
 */
export function FloatingScrollbar() {
  const trackRef = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState({ y: 0, h: MIN_THUMB, scrollable: false })
  const [active, setActive] = useState(false)
  const hover = useRef(false)
  const idle = useRef(0)

  const update = useCallback(() => {
    const doc = document.documentElement
    const max = doc.scrollHeight - window.innerHeight
    const h = Math.max(MIN_THUMB, Math.round(TRACK * Math.min(1, window.innerHeight / doc.scrollHeight)))
    const y = max > 0 ? Math.round((TRACK - h) * Math.min(1, window.scrollY / max)) : 0
    setThumb({ y, h, scrollable: max > 1 })
  }, [])

  const wake = useCallback(() => {
    setActive(true)
    window.clearTimeout(idle.current)
    idle.current = window.setTimeout(() => { if (!hover.current) setActive(false) }, IDLE_MS)
  }, [])

  useEffect(() => {
    const first = requestAnimationFrame(update)
    const onScroll = () => { update(); wake() }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', update)
    // Route changes and expanding panels change page height without scrolling.
    const observer = new ResizeObserver(update)
    observer.observe(document.body)
    return () => {
      cancelAnimationFrame(first)
      window.clearTimeout(idle.current)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', update)
      observer.disconnect()
    }
  }, [update, wake])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current
    if (!track) return
    event.preventDefault()
    const rect = track.getBoundingClientRect()
    const max = document.documentElement.scrollHeight - window.innerHeight
    const range = TRACK - thumb.h
    const onThumb = event.clientY >= rect.top + thumb.y && event.clientY <= rect.top + thumb.y + thumb.h
    const grab = onThumb ? event.clientY - (rect.top + thumb.y) : thumb.h / 2
    const to = (clientY: number, smooth: boolean) => {
      const y = Math.min(range, Math.max(0, clientY - rect.top - grab))
      window.scrollTo({ top: (y / range) * max, behavior: smooth ? 'smooth' : 'auto' })
    }
    if (!onThumb) to(event.clientY, true)
    track.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => { to(moveEvent.clientY, false); wake() }
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
      className={'fsb' + (active ? ' active' : '')}
      hidden={!thumb.scrollable}
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerEnter={() => { hover.current = true; setActive(true) }}
      onPointerLeave={() => { hover.current = false; wake() }}
    >
      <div className="fsb-thumb" style={{ height: thumb.h, transform: `translateY(${thumb.y}px)` }} />
    </div>
  )
}
