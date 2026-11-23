import { m } from 'framer-motion'
import type { Card } from '../engine/cards'
import { CardView } from './CardView'
import { AVATARS, type Settings } from './settings'
import { WalletPill } from './Money'
import type { Wallet } from './wallet'
import { SetupChip } from './PlayScreen'

interface Props {
  /** the bot game set up now (shown on the chip under "Играть") and the profile picture */
  settings: Settings
  wallet: Wallet
  bonus: boolean
  broke: boolean
  onBonus: () => void
  onRefill: () => void
  canContinue: boolean
  onContinue: () => void
  /** opens the bot game setup */
  onSetup: () => void
  /** starts a bot game right away with the setup on the chip */
  onQuick: () => void
  onFriendsGame: () => void
  onOpen: (panel: 'settings' | 'rules' | 'stats' | 'friends') => void
  friendCount: number
  /** a site on the iPhone home screen, which links never reach: offer to paste the invite instead */
  onPasteInvite?: () => void
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
  friends: 'M9 11a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm7.5.5a2.75 2.75 0 1 1 0-5.5 2.75 2.75 0 0 1 0 5.5zM9 13c3.3 0 6 1.7 6 3.8V19H3v-2.2C3 14.7 5.7 13 9 13zm7.5.5c2.5 0 4.5 1.3 4.5 3V19h-4v-2.2c0-1.3-.5-2.4-1.3-3.2.2 0 .5-.1.8-.1z',
}

const TILES: { id: 'stats' | 'friends' | 'settings'; label: string }[] = [
  { id: 'stats', label: 'Профиль' },
  { id: 'friends', label: 'Друзья' },
  { id: 'settings', label: 'Настройки' },
]

const enter = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  // leaving is quick and all at once: the next screen doesn't wait for the stagger
  exit: { opacity: 0, y: -10, transition: { duration: 0.15, delay: 0 } },
  transition: { delay, type: 'spring', stiffness: 380, damping: 30 },
})

export function MainMenu({ settings, wallet, bonus, broke, onBonus, onRefill, canContinue, onContinue, onSetup, onQuick, onFriendsGame, onOpen, friendCount, onPasteInvite }: Props) {
  return (
    <m.main className="menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25 }}>
      <WalletPill wallet={wallet} bonus={bonus} broke={broke} onBonus={onBonus} onRefill={onRefill} onOpen={() => onOpen('stats')} />
      <m.button type="button" className="icon menu-rules" aria-label="Правила" {...enter(0.2)} whileTap={{ scale: 0.9 }} onClick={() => onOpen('rules')}>
        ?
      </m.button>
      <div className="menu-hero">
        <div className="fan" aria-hidden="true">
          {FAN.map((c, i) => {
            const off = i - (FAN.length - 1) / 2
            return (
              <m.div
                key={c.id}
                className="fan-card"
                initial={{ rotate: 0, x: 0, y: 30, opacity: 0 }}
                animate={{ rotate: off * 11, x: off * 34, y: Math.abs(off) * 9, opacity: 1 }}
                transition={{ delay: 0.15 + i * 0.07, type: 'spring', stiffness: 220, damping: 20 }}
                whileHover={{ y: Math.abs(off) * 9 - 14 }}
              >
                <CardView card={c} faceUp trump="S" />
              </m.div>
            )
          })}
        </div>
        <m.h1 className="menu-logo" {...enter(0.35)}>
          Дурак
        </m.h1>
      </div>

      <div className="menu-actions">
        {canContinue && (
          <m.button type="button" className="primary big" {...enter(0.5)} whileTap={{ scale: 0.96 }} whileHover={{ y: -2 }} onClick={onContinue}>
            Продолжить партию
          </m.button>
        )}
        {/* With a game going, a new one opens the setup first: it says what the unfinished game's stake costs. */}
        <m.button type="button" className={`${canContinue ? 'ghost' : 'primary'} big`} {...enter(0.54)} whileTap={{ scale: 0.96 }} whileHover={{ y: -2 }} onClick={canContinue ? onSetup : onQuick}>
          {canContinue ? 'Новая партия' : 'Играть'}
        </m.button>
        <m.div className="play-chip-row" {...enter(0.58)}>
          <SetupChip settings={settings} wallet={wallet} onClick={onSetup} />
        </m.div>
        <m.button type="button" className="ghost big friends-play" {...enter(0.62)} whileTap={{ scale: 0.96 }} whileHover={{ y: -2 }} onClick={onFriendsGame}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d={ICONS.friends} />
          </svg>
          С друзьями
        </m.button>
        {onPasteInvite && (
          <m.button type="button" className="setup-chip paste-invite" {...enter(0.66)} whileTap={{ scale: 0.97 }} onClick={onPasteInvite}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2V4a1 1 0 0 1 1-1zm1 2v2h4V5h-4zm-2 7v2h8v-2H8zm0 4v2h5v-2H8z" />
            </svg>
            Вставить приглашение
          </m.button>
        )}
      </div>

      <div className="menu-tiles">
        {TILES.map((t, i) => (
          <m.button key={t.id} type="button" className="menu-tile" {...enter(0.7 + i * 0.06)} whileTap={{ scale: 0.94 }} whileHover={{ y: -4 }} onClick={() => onOpen(t.id)}>
            {t.id === 'stats' ? (
              <span className="tile-avatar" aria-hidden="true">
                {AVATARS[settings.avatar] ?? AVATARS[0]}
              </span>
            ) : (
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <path fill="currentColor" d={ICONS[t.id]} />
              </svg>
            )}
            <span>{t.label}</span>
            {t.id === 'friends' && friendCount > 0 && <span className="tile-badge">{friendCount}</span>}
          </m.button>
        ))}
      </div>

    </m.main>
  )
}
