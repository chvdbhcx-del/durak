import { AnimatePresence, m } from 'framer-motion'
import { useState } from 'react'
import { maxPlayers } from '../engine/game'
import { DeckPicker, DifficultyPicker, ModePicker, OpponentsPicker, Section, SeriesPicker, Switch } from './pickers'
import type { Settings } from './settings'
import { withValidOpponents } from './SettingsPanel'
import { StakePicker } from './Money'
import { affordableStake, formatCoins, LEVEL_BONUS, type Wallet } from './wallet'
import { sheetList } from './Sheet'

interface Props {
  settings: Settings
  wallet: Wallet
  /** coins riding on an unfinished bot game, lost if a new one starts */
  pendingStake: number
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
    <m.button type="button" className="icon" aria-label="Назад" whileTap={{ scale: 0.9 }} whileHover={{ x: -2 }} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M14.7 5.3a1 1 0 0 1 0 1.4L9.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z" />
      </svg>
    </m.button>
  )
}

/** "How do we play?": bots on this device, or friends online. */
export function PlayScreen({ settings, wallet, pendingStake, onChange, onBots, onOnline, onBack }: Props) {
  const [choice, setChoice] = useState<'bots' | null>(null)
  const set = (patch: Partial<Settings>) => onChange(withValidOpponents({ ...settings, ...patch }))
  const players = Math.min(settings.opponents + 1, maxPlayers(settings.deckSize))
  // a stake the balance can't cover drops to one it can, as more opponents raise what the fool pays
  const stake = affordableStake(wallet, settings.stake, players)

  return (
    <m.main className="screen" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}>
      <header className="screen-head">
        <BackButton onClick={onBack} />
        <h1>Как играем?</h1>
      </header>

      <div className="screen-body">
        <div className="way-cards">
          <m.button type="button" className={`way ${choice === 'bots' ? 'on' : ''}`} {...enter(0.05)} whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }} onClick={() => setChoice((c) => (c === 'bots' ? null : 'bots'))}>
            {choice === 'bots' && <m.span layoutId="way-ring" className="tile-ring" />}
            <span className="way-art bots" aria-hidden="true">
              {['Л', 'М', 'С'].map((l, i) => (
                <m.span key={l} className="way-avatar" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2 + i * 0.08, type: 'spring', stiffness: 500, damping: 20 }}>
                  {l}
                </m.span>
              ))}
            </span>
            <span className="way-title">С ботами</span>
            <span className="way-note">Даже без интернета</span>
          </m.button>

          <m.button type="button" className="way" {...enter(0.12)} whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }} onClick={onOnline}>
            <span className="way-art online" aria-hidden="true">
              <m.span className="way-pulse" animate={{ scale: [1, 1.5], opacity: [0.5, 0] }} transition={{ duration: 1.6, repeat: Infinity }} />
              <svg viewBox="0 0 24 24" width="30" height="30">
                <path
                  fill="currentColor"
                  d="M9 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0 2c3.3 0 7 1.6 7 4v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2c0-2.4 3.7-4 7-4zm8-2.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zm1 2.3c-.5 0-1 0-1.4.1 1.4.9 2.4 2.2 2.4 3.8v2h2a1 1 0 0 0 1-1v-1.6c0-2-2-3.3-4-3.3z"
                />
              </svg>
            </span>
            <span className="way-title">С друзьями</span>
            <span className="way-note">Комната по ссылке или коду</span>
          </m.button>
        </div>

        <AnimatePresence>
          {choice === 'bots' && (
            <m.div key="bots" className="setup" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 34 }}>
              <m.div className="setup-inner" variants={sheetList} initial="hidden" animate="shown">
                <Section title="Партия">
                  <ModePicker value={settings.mode} onChange={(mode) => set({ mode })} />
                  <DeckPicker value={settings.deckSize} onChange={(deckSize) => set({ deckSize })} />
                  <div className="switches">
                    <Switch label="Шулер" note="Можно мухлевать, но могут поймать" value={settings.cheat} onChange={(cheat) => set({ cheat })} />
                    <Switch label="Первый отбой — 5 карт" value={settings.firstFive} onChange={(firstFive) => set({ firstFive })} />
                  </div>
                </Section>
                <Section title="Соперники">
                  <OpponentsPicker title="Сколько" value={settings.opponents} max={maxPlayers(settings.deckSize) - 1} onChange={(opponents) => set({ opponents })} />
                  <DifficultyPicker value={settings.difficulty} onChange={(difficulty) => set({ difficulty })} />
                </Section>
                <Section title="Ставка">
                  <StakePicker title="Монеты" value={stake} onChange={(s) => set({ stake: s })} wallet={wallet} players={players} mult={LEVEL_BONUS[settings.difficulty]} />
                  <SeriesPicker value={settings.series} onChange={(series) => set({ series })} />
                </Section>
                {pendingStake > 0 && <p className="stake-warn">Незаконченная партия ещё идёт: если начать новую, её ставка {formatCoins(pendingStake)} сгорит.</p>}
                <m.button type="button" className="primary big setup-start" whileTap={{ scale: 0.96 }} whileHover={{ y: -2 }} onClick={onBots}>
                  {stake ? `Начать партию · ставка ${formatCoins(stake)}` : 'Начать партию'}
                </m.button>
              </m.div>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </m.main>
  )
}
