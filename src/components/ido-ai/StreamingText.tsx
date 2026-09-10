import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

const CHARS_PER_SECOND = 92

/**
 * Reveals text a character at a time on a rAF clock, at the reference's rate.
 *
 * This backend returns a whole message rather than a token stream, so the
 * reveal is presentational: it gives the assistant a speaking cadence instead
 * of a wall of text appearing at once. Text that has already been read — an
 * older message on reopening the panel — is shown immediately, and reduced
 * motion skips the reveal entirely.
 */
export function StreamingText({ text, animate = true, children }: { text: string; animate?: boolean; children?: (visible: string) => React.ReactNode }) {
  const reduced = useReducedMotion()
  const shouldAnimate = animate && !reduced
  const [count, setCount] = useState(() => (shouldAnimate ? 0 : text.length))
  const frame = useRef(0)

  useEffect(() => {
    if (!shouldAnimate) return
    const started = performance.now()
    const tick = (now: number) => {
      const shown = Math.min(text.length, Math.floor(((now - started) / 1000) * CHARS_PER_SECOND))
      setCount(shown)
      if (shown < text.length) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [text, shouldAnimate])

  const visible = shouldAnimate ? text.slice(0, count) : text
  return <>{children ? children(visible) : visible}</>
}
