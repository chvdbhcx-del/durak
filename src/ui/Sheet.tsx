import { m } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'

// Rows inside a sheet reveal one after another.
export const sheetList = { hidden: {}, shown: { transition: { staggerChildren: 0.045, delayChildren: 0.08 } } }
export const sheetItem = {
  hidden: { opacity: 0, y: 14 },
  shown: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 32 } },
} as const

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

/** Bottom sheet on phones, centred card on wider screens. */
export function Sheet({ title, onClose, children, footer, wide }: Props) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      // Tab stays inside the sheet while it is open.
      if (e.key !== 'Tab' || !box.current) return
      const items = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || !box.current.contains(document.activeElement))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !box.current.contains(document.activeElement))) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Focus moves into the sheet when it opens and back to what opened it when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    box.current?.focus({ preventScroll: true })
    return () => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [])

  return (
    <m.div className="overlay sheet-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <m.div
        ref={box}
        tabIndex={-1}
        className={`sheet ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ y: 60, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 50, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 360, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <m.button type="button" className="icon" aria-label="Закрыть" whileHover={{ rotate: 90 }} whileTap={{ scale: 0.88, rotate: 90 }} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="currentColor" d="M6.3 5 12 10.6 17.7 5 19 6.3 13.4 12l5.6 5.7-1.3 1.3-5.7-5.6L6.3 19 5 17.7l5.6-5.7L5 6.3z" />
            </svg>
          </m.button>
        </div>
        <m.div className="sheet-body" variants={sheetList} initial="hidden" animate="shown">
          {children}
        </m.div>
        {footer && (
          <m.div className="sheet-foot" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            {footer}
          </m.div>
        )}
      </m.div>
    </m.div>
  )
}

/**
 * Glides to the height of its content instead of jumping, so a sheet grows and shrinks smoothly
 * when a tab or a folded section changes what it holds.
 */
export function AutoHeight({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number | 'auto'>('auto')
  useEffect(() => {
    const el = inner.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <m.div className={className} initial={false} animate={{ height: h }} transition={{ type: 'spring', stiffness: 260, damping: 34, mass: 0.9 }} style={{ overflow: 'hidden' }}>
      <div ref={inner} style={{ position: 'relative' }}>
        {children}
      </div>
    </m.div>
  )
}
