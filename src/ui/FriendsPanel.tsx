import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { Friends } from '../net/useFriends'
import { Sheet, sheetItem } from './Sheet'

interface Props {
  friends: Friends
  onInvite: (fid: string) => void
  onClose: () => void
}

/** What a friend's row says about them; before the first answer it says so instead of claiming they are away. */
export function presenceText(friends: Friends, id: string): string {
  if (friends.here[id]) return 'в приложении'
  if (!friends.up) return 'нет связи с сервером'
  return friends.here[id] === undefined ? 'проверяем…' : 'не в сети'
}

export function FriendsPanel({ friends, onInvite, onClose }: Props) {
  const [removing, setRemoving] = useState<string | null>(null)
  const { refresh } = friends
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 12000)
    return () => clearInterval(t)
  }, [refresh])

  return (
    <Sheet title="Друзья" onClose={onClose}>
      {friends.list.length === 0 ? (
        <motion.div className="friends-empty" variants={sheetItem}>
          <span className="friends-empty-art" aria-hidden="true">
            🤝
          </span>
          <p>Пока никого. Сыграйте онлайн и нажмите «+» рядом с именем игрока за столом или в комнате, и он появится здесь.</p>
        </motion.div>
      ) : (
        <motion.ul className="friends" variants={sheetItem}>
          <AnimatePresence initial={false}>
            {friends.list.map((f) => (
              <motion.li key={f.id} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
                <span className="friend-avatar">
                  {f.name[0]?.toUpperCase()}
                  <i className={`friend-dot ${friends.here[f.id] ? 'on' : ''}`} aria-hidden="true" />
                </span>
                <span className="friend-name">
                  {f.name}
                  <small>{presenceText(friends, f.id)}</small>
                </span>
                {removing === f.id ? (
                  <span className="friend-actions">
                    <button type="button" className="link" onClick={() => setRemoving(null)}>
                      Отмена
                    </button>
                    <button
                      type="button"
                      className="link danger-link"
                      onClick={() => {
                        friends.remove(f.id)
                        setRemoving(null)
                      }}
                    >
                      Удалить
                    </button>
                  </span>
                ) : (
                  <span className="friend-actions">
                    <motion.button type="button" className="primary small" whileTap={{ scale: 0.94 }} onClick={() => onInvite(f.id)}>
                      Позвать
                    </motion.button>
                    <button type="button" className="toast-close" aria-label={`Убрать ${f.name} из друзей`} onClick={() => setRemoving(f.id)}>
                      ×
                    </button>
                  </span>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
      <motion.p className="foot-note" variants={sheetItem}>
        Приглашение приходит, пока у друга открыто приложение. Если друг не в сети, отправьте ему код или ссылку комнаты.
      </motion.p>
    </Sheet>
  )
}
