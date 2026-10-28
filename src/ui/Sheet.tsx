import { motion } from 'framer-motion'
import { useEffect, type ReactNode } from 'react'

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div className="overlay sheet-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
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
          <motion.button type="button" className="icon" aria-label="Закрыть" whileHover={{ rotate: 90 }} whileTap={{ scale: 0.88, rotate: 90 }} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="currentColor" d="M6.3 5 12 10.6 17.7 5 19 6.3 13.4 12l5.6 5.7-1.3 1.3-5.7-5.6L6.3 19 5 17.7l5.6-5.7L5 6.3z" />
            </svg>
          </motion.button>
        </div>
        <motion.div className="sheet-body" variants={sheetList} initial="hidden" animate="shown">
          {children}
        </motion.div>
        {footer && (
          <motion.div className="sheet-foot" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            {footer}
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  )
}
