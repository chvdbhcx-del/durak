import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useLayoutEffect, useRef, useState } from 'react'

/** Soft "ease out" curve: starts quick, lands gently, never overshoots. */
export const SOFT_EASE = [0.22, 1, 0.36, 1] as const

export interface MainActionSpec {
  label: string
  tone: 'primary' | 'danger'
  onClick?: () => void
}

/**
 * The one confirm button («Беру», «Пусть берёт», «Бито»…).
 *
 * It never leaves the layout: while there is nothing to press it fades out in
 * place, so the hint text next to it does not jump. A new label crossfades in,
 * and the width eases to fit it instead of snapping. While hidden it keeps the
 * last label it showed, so it does not flicker to «Ждём» on the way out.
 */
export function MainAction({ spec, shown }: { spec: MainActionSpec; shown: boolean }) {
  const reduce = useReducedMotion()
  const last = useRef(spec)
  if (shown) last.current = spec
  const { label, tone, onClick } = shown ? spec : last.current
  const active = shown && !!onClick

  // An invisible copy with the same class tells how wide the label wants to be.
  const sizer = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    const el = sizer.current
    if (!el) return
    const measure = () => setWidth(el.offsetWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (sizer.current) setWidth(sizer.current.offsetWidth)
  }, [label])

  const t = (d: number) => (reduce ? { duration: 0 } : { duration: d, ease: SOFT_EASE })

  return (
    <>
      <span ref={sizer} className={`main-action main-sizer ${tone}`} aria-hidden="true">
        {label}
      </span>
      <motion.button
        type="button"
        className={`main-action ${tone} ${active ? 'ready' : ''}`}
        disabled={!active}
        aria-hidden={!shown}
        tabIndex={shown ? undefined : -1}
        initial={false}
        animate={{
          opacity: shown ? 1 : 0,
          scale: shown ? 1 : 0.94,
          y: shown ? 0 : 4,
          ...(width ? { width } : {}),
        }}
        style={{ pointerEvents: shown ? undefined : 'none' }}
        transition={{
          default: t(shown ? 0.34 : 0.22),
          width: t(0.32),
        }}
        whileTap={active ? { scale: 0.96, transition: t(0.12) } : undefined}
        onClick={active ? onClick : undefined}
      >
        <AnimatePresence initial={false}>
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { ...t(0.3), delay: reduce ? 0 : 0.04 } }}
            exit={{ opacity: 0, y: -8, transition: t(0.2) }}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </>
  )
}
