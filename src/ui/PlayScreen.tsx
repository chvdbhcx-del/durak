import { m } from 'framer-motion'
import { maxPlayers } from '../engine/game'
import { DeckPicker, DifficultyPicker, ModePicker, OpponentsPicker, plural, Section, SeriesPicker, Switch } from './pickers'
import type { Settings } from './settings'
import { withValidOpponents } from './SettingsPanel'
import { Coin, StakePicker } from './Money'
import { affordableStake, formatCoins, LEVEL_BONUS, type Wallet } from './wallet'
import { Sheet } from './Sheet'

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <m.button type="button" className="icon" aria-label="Назад" whileTap={{ scale: 0.9 }} whileHover={{ x: -2 }} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M14.7 5.3a1 1 0 0 1 0 1.4L9.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z" />
      </svg>
    </m.button>
  )
}

const playersOf = (s: Settings) => Math.min(s.opponents + 1, maxPlayers(s.deckSize))

/** The bot game that "Играть" starts, in one line: «Подкидной · 36 · 2 бота · 100». */
export function SetupChip({ settings, wallet, onClick }: { settings: Settings; wallet: Wallet; onClick: () => void }) {
  const bots = playersOf(settings) - 1
  const stake = affordableStake(wallet, settings.stake, bots + 1)
  const label = `${settings.mode === 'podkidnoy' ? 'Подкидной' : 'Переводной'} · ${settings.deckSize} · ${bots} ${plural(bots, 'бот', 'бота', 'ботов')}`
  return (
    <m.button type="button" className="setup-chip play-chip" aria-label={`Настроить партию: ${label}${stake ? `, ставка ${stake}` : ''}`} whileTap={{ scale: 0.96 }} onClick={onClick}>
      <span>{label}</span>
      {stake > 0 && (
        <span className="play-chip-stake">
          · {formatCoins(stake)} <Coin size={12} />
        </span>
      )}
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d="M9.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 1 1-1.4-1.4l5.3-5.3-5.3-5.3a1 1 0 0 1 0-1.4z" />
      </svg>
    </m.button>
  )
}

interface Props {
  settings: Settings
  wallet: Wallet
  /** coins riding on an unfinished bot game, lost if a new one starts */
  pendingStake: number
  /** shown in the stake block when the balance can be topped up */
  onRefill?: () => void
  onChange: (s: Settings) => void
  onStart: () => void
  onClose: () => void
}

/** The bot game setup, opened from the chip under "Играть". */
export function BotSetupSheet({ settings, wallet, pendingStake, onRefill, onChange, onStart, onClose }: Props) {
  const set = (patch: Partial<Settings>) => onChange(withValidOpponents({ ...settings, ...patch }))
  const players = playersOf(settings)
  // a stake the balance can't cover drops to one it can, as more opponents raise what the fool pays
  const stake = affordableStake(wallet, settings.stake, players)

  return (
    <Sheet
      title="Партия с ботами"
      onClose={onClose}
      footer={
        <>
          {pendingStake > 0 && <p className="stake-warn">Ставка незаконченной партии {formatCoins(pendingStake)} сгорит.</p>}
          <m.button type="button" className="primary big" whileTap={{ scale: 0.96 }} whileHover={{ y: -2 }} onClick={onStart}>
            {stake ? `Начать · ставка ${formatCoins(stake)}` : 'Начать'}
          </m.button>
        </>
      }
    >
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
        <SeriesPicker value={settings.series} onChange={(series) => set({ series })} />
      </Section>
      <Section title="Ставка">
        <StakePicker title="Монеты" value={stake} onChange={(s) => set({ stake: s })} wallet={wallet} players={players} mult={LEVEL_BONUS[settings.difficulty]} wanted={settings.stake} onRefill={onRefill} />
      </Section>
    </Sheet>
  )
}
