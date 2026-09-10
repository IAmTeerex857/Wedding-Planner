import { useEffect, useState } from 'react'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import { SPRING_SWAP } from '../../lib/motion'

/** Phrases rotate on the reference's 1.8s cycle. */
const CYCLE_MS = 1800

const PHRASES = [
  'Thinking',
  'Reading your workspace',
  'Checking the ceremonies',
  'Looking at the budget',
  'Drafting a plan',
]

function elapsed(ms: number) {
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`
}

/**
 * The agent's thinking state, following the reference's reasoning-text pattern:
 * a rotating status phrase with a shimmer, its characters cascading in on a
 * stagger, alongside the elapsed time.
 *
 * A single unchanging spinner says only "something is happening". Naming the
 * step and counting the seconds says what and for how long, which is what makes
 * a wait bearable.
 */
export function ReasoningText() {
  const reduced = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [ms, setMs] = useState(0)

  useEffect(() => {
    const started = Date.now()
    const phrase = window.setInterval(() => setIndex((current) => (current + 1) % PHRASES.length), CYCLE_MS)
    const clock = window.setInterval(() => setMs(Date.now() - started), 100)
    return () => { window.clearInterval(phrase); window.clearInterval(clock) }
  }, [])

  const phrase = PHRASES[index]

  return (
    <div className="ido-ai-reasoning">
      <span className="sr-only" role="status" aria-live="polite">Thinking</span>
      <span className="ido-ai-reasoning-grid" aria-hidden="true">
        {Array.from({ length: 9 }, (_, cell) => <i key={cell} style={{ animationDelay: `${cell * 0.14}s` }} />)}
      </span>

      <span className="ido-ai-reasoning-phrase" aria-hidden="true">
        <AnimatePresence mode="wait" initial={false}>
          <m.span key={phrase} className="ido-ai-shimmer">
            {reduced
              ? phrase
              : phrase.split('').map((character, position) => (
                  <m.span
                    key={`${phrase}-${position}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ ...SPRING_SWAP, delay: position * 0.012 }}
                  >
                    {character === ' ' ? ' ' : character}
                  </m.span>
                ))}
          </m.span>
        </AnimatePresence>
      </span>

      <span className="ido-ai-reasoning-time" aria-hidden="true">{elapsed(ms)}</span>
    </div>
  )
}
