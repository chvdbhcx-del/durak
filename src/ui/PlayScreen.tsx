import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { maxPlayers } from '../engine/game'
import { CheatPicker, DeckPicker, ModePicker, OpponentsPicker } from './pickers'
import type { Settings } from './settings'
import { withValidOpponents } from './SettingsPanel'
import { sheetList } from './Sheet'

interface Props {
  settings: Settings
  onChange: (s: Settings) => void
  onBots: () => void
  onOnline: () => void
  onBack: () => void
}

const enter = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, type: 'spring', stiffness: 380, damping: 30 },
})

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button type="button" className="icon" aria-label="Назад" whileTap={{ scale: 0.9 }} whileHover={{ x: -2 }} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M14.7 5.3a1 1 0 0 1 0 1.4L9.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z" />
      </svg>
    </motion.button>
  )
}

/** "How do we play?": bots on this device, or friends online. */
export function PlayScreen({ settings, onChange, onBots, onOnline, onBack }: Props) {
  const [choice, setChoice] = useState<'bots' | null>(null)
  const set = (patch: Partial<Settings>) => onChange(withValidOpponents({ ...settings, ...patch }))

  return (
    <motion.main className="screen" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}>
      <header className="screen-head">
        <BackButton onClick={onBack} />
        <h1>Как играем?</h1>
      </header>

      <div className="screen-body">
        <div className="way-cards">
          <motion.button type="button" className={`way ${choice === 'bots' ? 'on' : ''}`} {...enter(0.05)} whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }} onClick={() => setChoice((c) => (c === 'bots' ? null : 'bots'))}>
            {choice === 'bots' && <motion.span layoutId="way-ring" className="tile-ring" />}
            <span className="way-art bots" aria-hidden="true">
              {['Л', 'М', 'С'].map((l, i) => (
                <motion.span key={l} className="way-avatar" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2 + i * 0.08, type: 'spring', stiffness: 500, damping: 20 }}>
                  {l}
                </motion.span>
              ))}
            </span>
            <span className="way-title">С ботами</span>
            <span className="way-note">На этом устройстве, даже без интернета</span>
          </motion.button>

          <motion.button type="button" className="way" {...enter(0.12)} whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }} onClick={onOnline}>
            <span className="way-art online" aria-hidden="true">
              <motion.span className="way-pulse" animate={{ scale: [1, 1.5], opacity: [0.5, 0] }} transition={{ duration: 1.6, repeat: Infinity }} />
              <svg viewBox="0 0 24 24" width="30" height="30">
                <path
                  fill="currentColor"
                  d="M9 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0 2c3.3 0 7 1.6 7 4v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2c0-2.4 3.7-4 7-4zm8-2.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zm1 2.3c-.5 0-1 0-1.4.1 1.4.9 2.4 2.2 2.4 3.8v2h2a1 1 0 0 0 1-1v-1.6c0-2-2-3.3-4-3.3z"
                />
              </svg>
            </span>
            <span className="way-title">Онлайн с друзьями</span>
            <span className="way-note">Создайте комнату и отправьте код</span>
          </motion.button>
        </div>

        <AnimatePresence>
          {choice === 'bots' && (
            <motion.div key="bots" className="setup" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 34 }}>
              <motion.div className="setup-inner" variants={sheetList} initial="hidden" animate="shown">
                <ModePicker value={settings.mode} onChange={(mode) => set({ mode })} />
                <OpponentsPicker value={settings.opponents} max={maxPlayers(settings.deckSize) - 1} onChange={(opponents) => set({ opponents })} />
                <DeckPicker value={settings.deckSize} onChange={(deckSize) => set({ deckSize })} />
                <CheatPicker value={settings.cheat} onChange={(cheat) => set({ cheat })} />
                <motion.button type="button" className="primary big" whileTap={{ scale: 0.96 }} whileHover={{ y: -2 }} onClick={onBots}>
                  Начать партию
                </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.main>
  )
}
