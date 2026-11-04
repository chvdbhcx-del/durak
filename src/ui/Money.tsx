import { animate, AnimatePresence, motion, useMotionValue } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Group, plural, Tile } from './pickers'
import { canAfford, formatCoins, STAKES, wagerTerms } from './wallet'
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
export function WalletPill({ wallet, bonus, broke, onBonus, onRefill }: { wallet: Wallet; bonus: boolean; broke: boolean; onBonus: () => void; onRefill: () => void }) {
  const [burst, setBurst] = useState(0)
  const prev = useRef(wallet.balance)
  useEffect(() => {
    if (wallet.balance > prev.current) setBurst((b) => b + 1)
    prev.current = wallet.balance
  }, [wallet.balance])
  return (
    <motion.div className="wallet-row" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, type: 'spring', stiffness: 380, damping: 30 }}>
      <span className="wallet-pill" aria-label={`Баланс ${formatCoins(wallet.balance)} ${plural(wallet.balance, 'монета', 'монеты', 'монет')}`}>
        <motion.span key={burst} initial={burst ? { rotateY: 0, scale: 1.3 } : false} animate={{ rotateY: 360, scale: 1 }} transition={{ duration: 0.7 }} style={{ display: 'inline-grid' }}>
          <Coin size={20} />
        </motion.span>
        <Coins value={wallet.balance} />
      </span>
      <AnimatePresence>
        {(bonus || broke) && (
          <motion.button
            key={bonus ? 'bonus' : 'refill'}
            type="button"
            className="wallet-gift"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            whileTap={{ scale: 0.92 }}
            onClick={bonus ? onBonus : onRefill}
          >
            <motion.span animate={{ rotate: [0, -12, 12, -6, 0] }} transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 2.4 }} aria-hidden="true">
              🎁
            </motion.span>
            {bonus ? 'Бонус дня' : 'Пополнить'}
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

const STAKE_NAMES: Record<number, { title: string; coins: number }> = {
  0: { title: 'Без денег', coins: 0 },
  100: { title: 'Мелкая', coins: 1 },
  500: { title: 'Средняя', coins: 2 },
  2500: { title: 'Крупная', coins: 3 },
}

/** Stake tiles; a stake the balance can't cover is greyed out. `mult` is what a win pays per staked coin. */
export function StakePicker({ value, onChange, wallet, players, mult, title = 'Ставка' }: { value: number; onChange: (n: number) => void; wallet: Wallet; players: number; mult: number; title?: string }) {
  const { held, prize } = wagerTerms(value, players, mult)
  const others = players - 1
  return (
    <Group title={title} value={`Баланс ${formatCoins(wallet.balance)}`}>
      <div className="tiles four">
        {STAKES.map((s) => {
          const name = STAKE_NAMES[s]
          const ok = canAfford(wallet, s, players)
          return (
            <Tile key={s} group="stake" on={value === s} disabled={!ok} onClick={() => onChange(s)} label={s ? `${name.title} ставка ${s}` : name.title}>
              <span className="stake-art" aria-hidden="true">
                {name.coins === 0 ? (
                  <span className="stake-none">♡</span>
                ) : (
                  Array.from({ length: name.coins }, (_, i) => (
                    <motion.span key={i} className="stake-coin" style={{ bottom: i * 6, left: `calc(50% - 11px + ${(i - (name.coins - 1) / 2) * 8}px)` }} initial={false} animate={value === s ? { y: [0, -5, 0] } : { y: 0 }} transition={{ delay: i * 0.06, duration: 0.4 }}>
                      <Coin size={22} />
                    </motion.span>
                  ))
                )}
              </span>
              <span className="tile-title">{s ? formatCoins(s) : name.title}</span>
              <span className="tile-note">{s ? name.title : 'Просто игра'}</span>
            </Tile>
          )
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={`${value}-${players}-${mult}`} className="stake-terms" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.18 }}>
          {value === 0 ? (
            'Играем на интерес: баланс не меняется.'
          ) : (
            <>
              Не дурак: <b className="good">+{formatCoins(prize)}</b>
              {mult !== 1 && <span className="muted"> (×{mult} за силу ботов)</span>}. Дурак платит <b className="bad">{formatCoins(held)}</b>
              {others > 1 && <span className="muted"> ({formatCoins(value)} каждому)</span>}.
            </>
          )}
        </motion.p>
      </AnimatePresence>
    </Group>
  )
}

/** The money line on the result card: what this game paid and the balance after it. */
export function Payout({ delta, balance }: { delta: number; balance: number }) {
  const tone = delta > 0 ? 'good' : delta < 0 ? 'bad' : ''
  return (
    <motion.div className={`payout ${tone}`} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 1, type: 'spring', stiffness: 380, damping: 18 }}>
      <span className="payout-delta">
        <Coin size={26} />
        {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
        <Coins value={Math.abs(delta)} from={0} />
      </span>
      <span className="payout-balance">
        Баланс <Coins value={balance} from={balance - delta} />
      </span>
    </motion.div>
  )
}
