import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { applyNow, RELEASES_URL, UpdateState } from './updates'

/** Floating pill that tells the player a new version is ready. */
export function UpdateToast({ state }: { state: UpdateState }) {
  const [hidden, setHidden] = useState<string | null>(null)
  const visible = (state.kind === 'ready' || state.kind === 'needs-app') && hidden !== state.version
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="toast"
          role="status"
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
        >
          <span className="toast-dot" aria-hidden="true" />
          <span className="toast-text">
            {state.kind === 'ready' ? `Версия ${state.version} скачана` : `Вышло приложение ${state.version}`}
          </span>
          {state.kind === 'ready' ? (
            <motion.button type="button" className="primary small" whileTap={{ scale: 0.94 }} onClick={() => applyNow(state.bundle)}>
              Обновить
            </motion.button>
          ) : (
            <a className="primary small" href={RELEASES_URL} target="_blank" rel="noreferrer">
              Скачать
            </a>
          )}
          <button type="button" className="toast-close" aria-label="Позже" onClick={() => setHidden(state.version)}>
            ×
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
