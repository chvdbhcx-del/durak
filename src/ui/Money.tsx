import { animate, AnimatePresence, m, useMotionValue } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Group, plural, Tile } from './pickers'
import { canAfford, formatCoins, REFILL, STAKES, wagerTerms } from './wallet'
import type { Wallet } from './wallet'

/** A brass coin, drawn so it reads at 14px and at 40px. */
export function Coin({ size = 16 }: { size?: number }) {
  return (
    <svg className="coin" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="10.5" className="coin-rim" />
      <circle cx="12" cy="12" r="7.6" className="coin-face" />
      <path className="coin-mark" d="M12 7.2l1.5 3.1 3.4.5-2.5 2.4.6 3.4-3-1.6-3 1.6.6-3.4-2.5-2.4 3.4-.5z" />
    </svg>
  )
}

/** A coin amount that rolls to its new value. */
export function Coins({ value, from }: { value: number; from?: number }) {
  const mv = useMotionValue(from ?? value)
  const [text, setText] = useState(from ?? value)
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.9, ease: [0.2, 0.8, 0.2, 1] })
    const unsub = mv.on('change', (v) => setText(Math.round(v)))
    return () => {
      controls.stop()
      unsub()
    }
  }, [value, mv])
  return <span className="coins-num">{formatCoins(text)}</span>
}

/** The balance pill on the main menu, with the daily bonus or a refill when the player is broke. */
/**
 * `broke` means a refill is on offer right now (see canRefill). `onOpen`, when given, makes the
 * balance itself a button, for instance to the profile with the wallet card.
 */
export function WalletPill({ wallet, bonus, broke, onBonus, onRefill, onOpen }: { wallet: Wallet; bonus: boolean; broke: boolean; onBonus: () => void; onRefill: () => void; onOpen?: () => void }) {
  const [burst, setBurst] = useState(0)
  const prev = useRef(wallet.balance)
  useEffect(() => {
    if (wallet.balance > prev.current) setBurst((b) => b + 1)
    prev.current = wallet.balance
  }, [wallet.balance])
  return (
    <m.div className="wallet-row" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, type: 'spring', stiffness: 380, damping: 30 }}>
      {(() => {
        const label = `Баланс ${formatCoins(wallet.balance)} ${plural(wallet.balance, 'монета', 'монеты', 'монет')}`
        const inner = (
          <>
            <m.span key={burst} initial={burst ? { rotateY: 0, scale: 1.3 } : false} animate={{ rotateY: 360, scale: 1 }} transition={{ duration: 0.7 }} style={{ display: 'inline-grid' }}>
              <Coin size={20} />
            </m.span>
            <Coins value={wallet.balance} />
          </>
        )
        return onOpen ? (
          <m.button type="button" className="wallet-pill" aria-label={`${label}. Открыть профиль`} whileTap={{ scale: 0.95 }} onClick={onOpen}>
            {inner}
          </m.button>
        ) : (
          <span className="wallet-pill" aria-label={label}>
            {inner}
          </span>
        )
      })()}
      <AnimatePresence>
        {(bonus || broke) && (
          <m.button
            key={bonus ? 'bonus' : 'refill'}
            type="button"
            className="wallet-gift"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            whileTap={{ scale: 0.92 }}
            onClick={bonus ? onBonus : onRefill}
          >
            <m.span animate={{ rotate: [0, -12, 12, -6, 0] }} transition={{ duration: 0.9, repeat: 2, repeatDelay: 2.4 }} aria-hidden="true">
              🎁
            </m.span>
            {bonus ? 'Бонус дня' : 'Пополнить'}
          </m.button>
        )}
      </AnimatePresence>
    </m.div>
  )
}

const STAKE_NAMES: Record<number, { title: string; coins: number }> = {
  0: { title: 'Без денег', coins: 0 },
  100: { title: 'Мелкая', coins: 1 },
  250: { title: 'Средняя', coins: 2 },
  1000: { title: 'Крупная', coins: 3 },
}

interface StakeProps {
  value: number
  onChange: (n: number) => void
  wallet: Wallet
  players: number
  /** what a win pays per staked coin */
  mult: number
  title?: string
  /** the stake the player picked, when `value` had to drop below it: a short note says so */
  wanted?: number
  /** offered inside the block when not even the smallest stake fits and a refill is available */
  onRefill?: () => void
}

/**
 * Stake tiles. A stake the balance can't cover is greyed out and says how much it needs.
 * Below them, what a win and a loss mean, as two numbers (the full sentence is the tiles' label for screen readers).
 */
export function StakePicker({ value, onChange, wallet, players, mult, title = 'Ставка', wanted, onRefill }: StakeProps) {
  const { held, prize } = wagerTerms(value, players, mult)
  const others = players - 1
  const lowered = wanted !== undefined && wanted > value
  const noneFits = !canAfford(wallet, STAKES[1], players)
  return (
    <Group title={title} value={`Баланс ${formatCoins(wallet.balance)}`}>
      <div className="tiles four">
        {STAKES.map((s) => {
          const name = STAKE_NAMES[s] ?? { title: formatCoins(s), coins: 1 }
          const ok = canAfford(wallet, s, players)
          const need = wagerTerms(s, players).held
          const label = s ? (ok ? `${name.title} ставка ${formatCoins(s)}` : `${name.title} ставка ${formatCoins(s)}, нужно ${formatCoins(need)} монет`) : name.title
          return (
            <Tile key={s} group="stake" on={value === s} disabled={!ok} onClick={() => onChange(s)} label={label}>
              <span className="stake-art" aria-hidden="true">
                {name.coins === 0 ? (
                  <span className="stake-none">♡</span>
                ) : (
                  Array.from({ length: name.coins }, (_, i) => (
                    <m.span key={i} className="stake-coin" style={{ bottom: i * 6, left: `calc(50% - 11px + ${(i - (name.coins - 1) / 2) * 8}px)` }} initial={false} animate={value === s ? { y: [0, -5, 0] } : { y: 0 }} transition={{ delay: i * 0.06, duration: 0.4 }}>
                      <Coin size={22} />
                    </m.span>
                  ))
                )}
              </span>
              <span className="tile-title">{s ? formatCoins(s) : name.title}</span>
              {s > 0 && <span className="tile-note">{ok ? name.title : `нужно ${formatCoins(need)}`}</span>}
            </Tile>
          )
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <m.p
          key={`${value}-${players}-${mult}-${lowered}`}
          className="stake-terms"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.18 }}
          aria-label={value === 0 ? 'На интерес' : `Не дурак получает ${formatCoins(prize)}${mult !== 1 ? `, ×${mult} за силу ботов` : ''}. Дурак платит ${formatCoins(held)}${others > 1 ? `, по ${formatCoins(value)} каждому` : ''}.`}
        >
          {value === 0 ? (
            <span className="muted">На интерес</span>
          ) : (
            <>
              <span className="term good" title={mult !== 1 ? `×${mult} за силу ботов` : 'Если не останетесь дураком'}>
                ▲ +{formatCoins(prize)}
              </span>
              <span className="term bad" title={others > 1 ? `${formatCoins(value)} каждому` : 'Если останетесь дураком'}>
                ▼ −{formatCoins(held)}
              </span>
            </>
          )}
          {lowered && <span className="term-note">ставка снижена до {value ? formatCoins(value) : '0'}</span>}
        </m.p>
      </AnimatePresence>
      {noneFits && onRefill && (
        <m.button type="button" className="wallet-gift stake-refill" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} whileTap={{ scale: 0.94 }} onClick={onRefill}>
          <span aria-hidden="true">🎁</span> Пополнить до {formatCoins(REFILL)}
        </m.button>
      )}
    </Group>
  )
}

/**
 * The money line on the result card: what this game paid and the balance after it. With `onRefill`
 * (passed when the game left the player without enough for any stake) a refill button replaces the balance.
 */
export function Payout({ delta, balance, onRefill }: { delta: number; balance: number; onRefill?: () => void }) {
  const tone = delta > 0 ? 'good' : delta < 0 ? 'bad' : ''
  return (
    <m.div className={`payout ${tone}`} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 1, type: 'spring', stiffness: 380, damping: 18 }}>
      <span className="payout-delta">
        <Coin size={26} />
        {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
        <Coins value={Math.abs(delta)} from={0} />
      </span>
      {onRefill ? (
        <m.button type="button" className="wallet-gift" whileTap={{ scale: 0.94 }} onClick={onRefill}>
          <span aria-hidden="true">🎁</span> Пополнить до {formatCoins(REFILL)}
        </m.button>
      ) : (
        <span className="payout-balance">
          Баланс <Coins value={balance} from={balance - delta} />
        </span>
      )}
    </m.div>
  )
}
