import type { Transition, Variants } from 'motion/react'

/**
 * Motion constants from the beui chat-app reference, so the assistant moves
 * with the same physics as the component we took the interaction patterns from.
 * Kept in one place: change the feel here, not per component.
 */
export const SPRING_LAYOUT: Transition = { type: 'spring', stiffness: 360, damping: 32, mass: 0.6 }
export const SPRING_SWAP: Transition = { type: 'spring', stiffness: 460, damping: 30, mass: 0.55 }
export const SPRING_PRESS: Transition = { type: 'spring', stiffness: 500, damping: 30, mass: 0.6 }

export const EASE_OUT = [0.16, 1, 0.3, 1] as const
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const

/** A message arriving in the thread. */
export const messageVariants: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: SPRING_SWAP },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15, ease: EASE_OUT } },
}

/** The history overlay sliding across the widget. */
export const panelVariants: Variants = {
  hidden: { x: '-100%' },
  visible: { x: 0, transition: SPRING_LAYOUT },
  exit: { x: '-100%', transition: { duration: 0.22, ease: EASE_IN_OUT } },
}

/** Rows staggering in behind the panel. */
export const listVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03, delayChildren: 0.06 } },
}

export const rowVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: SPRING_SWAP },
}
