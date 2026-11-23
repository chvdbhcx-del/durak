import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useState } from 'react'
import { GUEST_PATIENCE_MS } from '../net/room'

export interface LinkState {
  /** this device is a guest; the host is the one who may have gone */
  guest: boolean
  reconnecting: boolean
  /** guest: when the line to the host dropped */
  lostAt?: number
  /** guest: the host put the app in the background */
  hostAway?: boolean
  hostName?: string
  onLeave?: () => void
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * An honest word about the line to the room: a host gone quiet is named, with how long we wait for them
 * and a way out, instead of a table that just freezes.
 */
export function RoomLink({ link, inline = false }: { link: LinkState; inline?: boolean }) {
  const { guest, reconnecting, lostAt = 0, hostAway, hostName = 'Хост', onLeave } = link
  const [now, setNow] = useState(Date.now)
  const counting = guest && reconnecting && lostAt > 0
  useEffect(() => {
    if (!counting) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [counting])
  const show = reconnecting || (guest && hostAway)
  let text = 'Восстанавливаем связь…'
  if (guest && reconnecting) text = lostAt ? `${hostName} не отвечает, ждём ${clock(GUEST_PATIENCE_MS - (now - lostAt))}` : `${hostName} не отвечает, ждём…`
  else if (guest && hostAway) text = `${hostName} свернул игру, ждём`
  return (
    <AnimatePresence>
      {show && (
        <m.div key="link" className={`reconnecting ${inline ? 'inline' : ''}`} role="status" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
          <m.span className="toast-dot" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
          <span className="link-text">{text}</span>
          {guest && reconnecting && onLeave && (
            <button type="button" className="link link-leave" onClick={onLeave}>
              Выйти
            </button>
          )}
        </m.div>
      )}
    </AnimatePresence>
  )
}
