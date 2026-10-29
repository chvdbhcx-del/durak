import { AnimatePresence, motion } from 'framer-motion'
import type { Friends } from '../net/useFriends'

interface Props {
  friends: Friends
  /** a game or room is on, so an invitation has to wait */
  busy: boolean
  onJoin: (code: string, server?: string) => void
}

/** Incoming invitations and friend requests, plus short confirmations. */
export function FriendToast({ friends, busy, onJoin }: Props) {
  const inc = friends.incoming
  return (
    <div className="toasts">
      <AnimatePresence mode="popLayout">
        {inc && (
          <motion.div key={inc.id} layout className="toast" role="alert" initial={{ opacity: 0, y: -30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20, scale: 0.97 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
            <span className="toast-dot" aria-hidden="true" />
            <span className="toast-text">{inc.kind === 'invite' ? `${inc.name} зовёт сыграть` : `${inc.name} хочет дружить`}</span>
            {inc.kind === 'invite' ? (
              <motion.button
                type="button"
                className="primary small"
                disabled={busy}
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  onJoin(inc.code, inc.server)
                  friends.dismiss()
                }}
              >
                {busy ? 'После партии' : 'Сыграть'}
              </motion.button>
            ) : (
              <motion.button
                type="button"
                className="primary small"
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  friends.add(inc.fid, inc.name)
                  friends.dismiss()
                }}
              >
                Принять
              </motion.button>
            )}
            <button type="button" className="toast-close" aria-label="Отклонить" onClick={friends.dismiss}>
              ×
            </button>
          </motion.div>
        )}
        {friends.flash && (
          <motion.div key={friends.flash} layout className="toast" role="status" initial={{ opacity: 0, y: -30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
            <span className="toast-text">{friends.flash}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
