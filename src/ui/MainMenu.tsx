import { motion } from 'framer-motion'
import type { Card } from '../engine/cards'
import { CardView } from './CardView'
import type { Settings, Stats } from './settings'
import { useEffect, useState } from 'react'
import { UpdateLog, watchUpdateLog, WEB_VERSION } from './updates'

interface Props {
  settings: Settings
  stats: Stats
  canContinue: boolean
  onContinue: () => void
  onPlay: () => void
  onOpen: (panel: 'settings' | 'rules' | 'stats') => void
}

// The hero fan: an ace of trumps flanked by court cards.
const FAN: Card[] = [
  { id: 'menu-D12', suit: 'D', rank: 12 },
  { id: 'menu-C11', suit: 'C', rank: 11 },
  { id: 'menu-S14', suit: 'S', rank: 14 },
  { id: 'menu-H13', suit: 'H', rank: 13 },
  { id: 'menu-S10', suit: 'S', rank: 10 },
]

const ICONS = {
  settings: 'M4 7h10.2a3 3 0 0 1 5.6 0H20a1 1 0 1 1 0 2h-.2a3 3 0 0 1-5.6 0H4a1 1 0 0 1 0-2zm13 2a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM4 15h.2a3 3 0 0 1 5.6 0H20a1 1 0 1 1 0 2H9.8a3 3 0 0 1-5.6 0H4a1 1 0 1 1 0-2zm3 2a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  rules: 'M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm8 1.5V8h3.5L14 4.5zM8 11v1.6h8V11H8zm0 3.6v1.6h8v-1.6H8zm0 3.6v1.6h5v-1.6H8z',
  stats: 'M4 20V10h3.5v10H4zm6.25 0V4h3.5v16h-3.5zM16.5 20v-7H20v7h-3.5z',
}

const TILES: { id: 'settings' | 'rules' | 'stats'; label: string }[] = [
  { id: 'settings', label: 'Настройки' },
  { id: 'rules', label: 'Правила' },
  { id: 'stats', label: 'Статистика' },
]

const enter = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { delay, type: 'spring', stiffness: 380, damping: 30 },
})

function useUpdateLog() {
  const [log, setLog] = useState<UpdateLog | null>(null)
  useEffect(() => watchUpdateLog(setLog), [])
  return log
}

export function MainMenu({ settings, stats, canContinue, onContinue, onPlay, onOpen }: Props) {
  const setup = `${settings.mode === 'podkidnoy' ? 'Подкидной' : 'Переводной'} · ${settings.deckSize} карт · ${settings.opponents} ${settings.opponents === 1 ? 'соперник' : settings.opponents < 5 ? 'соперника' : 'соперников'}`
  const updateLog = useUpdateLog()
  return (
    <motion.main className="menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25 }}>
      <div className="menu-hero">
        <div className="fan" aria-hidden="true">
          {FAN.map((c, i) => {
            const off = i - (FAN.length - 1) / 2
            return (
              <motion.div
                key={c.id}
                className="fan-card"
                initial={{ rotate: 0, x: 0, y: 30, opacity: 0 }}
                animate={{ rotate: off * 11, x: off * 34, y: Math.abs(off) * 9, opacity: 1 }}
                transition={{ delay: 0.15 + i * 0.07, type: 'spring', stiffness: 220, damping: 20 }}
                whileHover={{ y: Math.abs(off) * 9 - 14 }}
              >
                <CardView card={c} faceUp trump="S" />
              </motion.div>
            )
          })}
        </div>
        <motion.h1 className="menu-logo" {...enter(0.35)}>
          Дурак
        </motion.h1>
        <motion.p className="menu-tag" {...enter(0.42)}>
          Подкидной и переводной. С ботами или с друзьями онлайн
        </motion.p>
      </div>

      <div className="menu-actions">
        {canContinue && (
          <motion.button type="button" className="primary big" {...enter(0.5)} whileTap={{ scale: 0.96 }} whileHover={{ y: -2 }} onClick={onContinue}>
            Продолжить партию
          </motion.button>
        )}
        <motion.button type="button" className={canContinue ? 'ghost big' : 'primary big'} {...enter(canContinue ? 0.56 : 0.5)} whileTap={{ scale: 0.96 }} whileHover={{ y: -2 }} onClick={onPlay}>
          {canContinue ? 'Новая партия' : 'Играть'}
        </motion.button>
        <motion.button type="button" className="setup-chip" {...enter(0.62)} whileTap={{ scale: 0.97 }} onClick={() => onOpen('settings')}>
          {setup}
        </motion.button>
      </div>

      <div className="menu-tiles">
        {TILES.map((t, i) => (
          <motion.button key={t.id} type="button" className="menu-tile" {...enter(0.68 + i * 0.06)} whileTap={{ scale: 0.94 }} whileHover={{ y: -4 }} onClick={() => onOpen(t.id)}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path fill="currentColor" d={ICONS[t.id]} />
            </svg>
            <span>{t.label}</span>
            {t.id === 'stats' && stats.wins + stats.losses + stats.draws > 0 && <span className="tile-badge">{stats.wins}</span>}
          </motion.button>
        ))}
      </div>

      <motion.p className="menu-version" {...enter(0.9)}>
        Версия {WEB_VERSION}
        {updateLog && <span className="update-log">{updateLog.text}</span>}
      </motion.p>
    </motion.main>
  )
}
