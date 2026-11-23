import { animate, AnimatePresence, m, useMotionValue, useTransform } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { Suit } from '../engine/cards'
import { AVATARS, cleanName, type HistoryEntry, type Settings, type Stats } from './settings'
import { Coin } from './Money'
import { formatCoins, neverStaked, type Wallet } from './wallet'
import { AvatarPicker, plural } from './pickers'
import { Sheet, sheetItem } from './Sheet'
import { SuitIcon } from './SuitIcon'
import { ClassicFace } from './CardView'

type Mini = [suit: Suit, rank: number]

/** A tiny table moment drawn with real card faces: attacks on the bottom, covers on top, a card flying in. */
interface Scene {
  trump: Suit
  /** pairs on the table: an attack and maybe its cover */
  pairs: [Mini, Mini?][]
  /** a card that arrives on the table after the rest: a throw-in or a transfer */
  incoming?: Mini
  /** the cover is a trick: it doesn't beat */
  trick?: boolean
  /** a row of overlapping cards instead of pairs, e.g. the five of the first round */
  row?: Mini[]
}

const RULES: { suit: Suit; title: string; text: string; scene?: Scene }[] = [
  { suit: 'S', title: 'Цель', text: 'Избавиться от всех карт. Кто остался с картами последним, тот дурак.' },
  { suit: 'H', title: 'Козырь', text: 'Масть открытой карты под колодой. Козырь бьёт любую карту другой масти.', scene: { trump: 'S', pairs: [[['H', 14], ['S', 6]]] } },
  { suit: 'D', title: 'Атака', text: 'Ходящий кладёт любую карту. Первым ходит тот, у кого самый младший козырь.', scene: { trump: 'S', pairs: [], incoming: ['C', 8] } },
  { suit: 'C', title: 'Защита', text: 'Покрыть можно старшей картой той же масти или козырем. Не можете — берите.', scene: { trump: 'S', pairs: [[['H', 9], ['H', 12]]] } },
  { suit: 'H', title: 'Подкидывание', text: 'Другие подкидывают карты того же достоинства, что уже на столе. Всего не больше шести.', scene: { trump: 'S', pairs: [[['H', 9], ['H', 12]]], incoming: ['C', 9] } },
  { suit: 'S', title: 'Перевод', text: 'В переводном, пока ничего не покрыто, положите карту того же достоинства: отбивается следующий.', scene: { trump: 'S', pairs: [[['D', 7]]], incoming: ['C', 7] } },
  { suit: 'D', title: 'Бито и добор', text: 'Отбился — карты уходят в бито, и ходите вы. После хода все добирают до шести.' },
  { suit: 'C', title: 'Конец игры', text: 'Когда колода кончилась, игроки без карт выходят. Если последние карты ушли одновременно, это ничья.' },
  { suit: 'H', title: 'Шулер', text: 'Можно покрыть любой картой. Заметили обман — нажмите на карту, и обманщик берёт.', scene: { trump: 'S', pairs: [[['C', 10], ['H', 6]]], trick: true } },
  { suit: 'S', title: 'Первый отбой', text: 'Если включено, в первом раунде на стол идёт не больше пяти карт.', scene: { trump: 'S', pairs: [], row: [['S', 9], ['H', 9], ['C', 11], ['D', 11], ['C', 9]] } },
]

// Shown only where there is a keyboard and a mouse: phones don't need it.
const KEYS_RULE: { suit: Suit; title: string; text: string; scene?: Scene } = { suit: 'S', title: 'Клавиши', text: '← → выбрать карту, Enter положить. 1–9 сразу кладут карту, Пробел жмёт главную кнопку, T — беру, R — прочитать стол, Esc — отмена.' }
const hasKeyboard = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches

function MiniCard({ c, trump, className = '' }: { c: Mini; trump: Suit; className?: string }) {
  return (
    <span className={`card full sample ${className}`}>
      <ClassicFace card={{ id: `rule-${c[0]}${c[1]}`, suit: c[0], rank: c[1] }} trump={trump} />
    </span>
  )
}

function RuleScene({ scene }: { scene: Scene }) {
  const fly = { initial: { opacity: 0, y: 26, rotate: -8 }, whileInView: { opacity: 1, y: 0, rotate: 0 }, viewport: { once: true, amount: 0.6 } }
  if (scene.row)
    return (
      <span className="rule-scene row" aria-hidden="true">
        {scene.row.map((c, i) => (
          <m.span key={i} className="rule-row" {...fly} transition={{ delay: 0.2 + i * 0.08, type: 'spring', stiffness: 300, damping: 24 }}>
            <MiniCard c={c} trump={scene.trump} />
          </m.span>
        ))}
      </span>
    )
  return (
    <span className="rule-scene" aria-hidden="true">
      {scene.pairs.map(([attack, cover], i) => (
        <span key={i} className="rule-pair">
          <MiniCard c={attack} trump={scene.trump} />
          {cover && (
            <m.span className="rule-cover" initial={{ opacity: 0, x: 18, y: 14, rotate: 0 }} whileInView={{ opacity: 1, x: 0, y: 0, rotate: 8 }} viewport={{ once: true, amount: 0.6 }} transition={{ delay: 0.35, type: 'spring', stiffness: 260, damping: 22 }}>
              <MiniCard c={cover} trump={scene.trump} />
              {scene.trick && (
                <m.b className="rule-trick" initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.9, type: 'spring', stiffness: 500, damping: 18 }}>
                  ?
                </m.b>
              )}
            </m.span>
          )}
        </span>
      ))}
      {scene.incoming && (
        <m.span className="rule-pair" {...fly} transition={{ delay: scene.pairs.length ? 0.8 : 0.3, type: 'spring', stiffness: 280, damping: 22 }}>
          <MiniCard c={scene.incoming} trump={scene.trump} />
        </m.span>
      )}
    </span>
  )
}

export function RulesPanel({ onClose }: { onClose: () => void }) {
  const rules = hasKeyboard() ? [...RULES, KEYS_RULE] : RULES
  return (
    <Sheet title="Правила" onClose={onClose} wide>
      <div className="rules">
        {rules.map((r, i) => (
          <m.article key={r.title} className="rule" variants={sheetItem} whileHover={{ y: -3 }}>
            <span className={`rule-suit ${r.suit === 'H' || r.suit === 'D' ? 'red' : ''}`} aria-hidden="true">
              <SuitIcon suit={r.suit} size="100%" />
            </span>
            <span className="rule-step">{i + 1}</span>
            <h3>{r.title}</h3>
            {r.scene && <RuleScene scene={r.scene} />}
            <p>{r.text}</p>
          </m.article>
        ))}
      </div>
    </Sheet>
  )
}

/** Number that counts up from zero when the panel opens. */
function CountUp({ value }: { value: number }) {
  const mv = useMotionValue(0)
  const rounded = useTransform(mv, (v) => Math.round(v))
  const [text, setText] = useState(0)
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.9, ease: [0.2, 0.8, 0.2, 1] })
    const unsub = rounded.on('change', setText)
    return () => {
      controls.stop()
      unsub()
    }
  }, [value, mv, rounded])
  return <>{formatCoins(text)}</>
}

const SLICE_NAMES: [string, string][] = [
  ['mode:podkidnoy', 'Подкидной'],
  ['mode:perevodnoy', 'Переводной'],
  ['rules:classic', 'Классика'],
  ['rules:cheat', 'Шулер'],
  ['level:easy', 'Лёгкий бот'],
  ['level:normal', 'Обычный бот'],
  ['level:hard', 'Сильный бот'],
  ['where:bots', 'С ботами'],
  ['where:online', 'Онлайн'],
]

/** Win share per mode, rules and bot strength; only slices that have games are shown. */
function Breakdown({ by }: { by?: Stats['by'] }) {
  const rows = SLICE_NAMES.flatMap(([key, name]) => {
    const t = by?.[key]
    const total = t ? t[0] + t[1] + t[2] : 0
    return t && total > 0 ? [{ key, name, t, total }] : []
  })
  if (rows.length === 0) return null
  return (
    <m.div className="breakdown" variants={sheetItem}>
      <h3>По режимам</h3>
      {rows.map(({ key, name, t, total }) => (
        <div key={key} className="bd-row">
          <span className="bd-name">{name}</span>
          <span className="bd-bar" aria-hidden="true">
            <m.i initial={{ width: 0 }} animate={{ width: `${(t[0] / total) * 100}%` }} transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }} />
          </span>
          <span className="bd-num">
            {Math.round((t[0] / total) * 100)}% · {total}
          </span>
        </div>
      ))}
    </m.div>
  )
}

const RESULT_TEXT = { win: 'Победа', loss: 'Остались дураком', draw: 'Ничья' } as const

function when(at: number) {
  const d = new Date(at)
  const today = new Date()
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === today.toDateString() ? `сегодня, ${time}` : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${time}`
}

function gameNote(h: HistoryEntry) {
  return `${h.online ? 'Онлайн' : 'С ботами'} · ${h.mode === 'podkidnoy' ? 'подкидной' : 'переводной'} · ${h.players} ${plural(h.players, 'игрок', 'игрока', 'игроков')}`
}

function NameField({ name, onChange }: { name: string; onChange: (n: string) => void }) {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const commit = () => {
    const next = cleanName(draft, name)
    setDraft(next)
    if (next !== name) onChange(next)
  }
  return (
    <label className="name-field">
      <input className="profile-name" value={draft} maxLength={16} aria-label="Имя" placeholder="Ваше имя" onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <svg className="name-pencil" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="currentColor" d="M15.2 4.6a2 2 0 0 1 2.8 0l1.4 1.4a2 2 0 0 1 0 2.8L9.6 18.6 5 19.5l.9-4.6 9.3-9.3zM7.7 15.8l-.3 1.3 1.3-.3 8.4-8.4-1-1-8.4 8.4z" />
      </svg>
    </label>
  )
}

interface StatsProps {
  stats: Stats
  wallet: Wallet
  settings: Settings
  onSettings: (s: Settings) => void
  onClose: () => void
  onReset: () => void
  /** "Играть" in the empty profile */
  onPlay?: () => void
}

export function StatsPanel({ stats, wallet, settings, onSettings, onClose, onReset, onPlay }: StatsProps) {
  const [confirm, setConfirm] = useState(false)
  const [pick, setPick] = useState(false)
  const games = stats.wins + stats.losses + stats.draws
  const rate = games ? stats.wins / games : 0
  const R = 52
  const C = 2 * Math.PI * R

  return (
    <Sheet title="Профиль" onClose={onClose}>
      <m.div className="profile-head" variants={sheetItem}>
        <m.button
          type="button"
          key={settings.avatar}
          className="profile-avatar"
          aria-label="Сменить аватар"
          aria-expanded={pick}
          initial={{ scale: 0.6, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          onClick={() => setPick((v) => !v)}
        >
          {AVATARS[settings.avatar] ?? AVATARS[0]}
        </m.button>
        <NameField name={settings.name} onChange={(name) => onSettings({ ...settings, name })} />
      </m.div>
      <AnimatePresence initial={false}>
        {pick && (
          <m.div key="pick" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
            <AvatarPicker
              value={settings.avatar}
              onChange={(avatar) => {
                onSettings({ ...settings, avatar })
                setPick(false)
              }}
            />
          </m.div>
        )}
      </AnimatePresence>

      <m.div className="wallet-card" variants={sheetItem}>
        <span className="wallet-card-main">
          <Coin size={34} />
          <span>
            <span className="wallet-card-num">
              <CountUp value={wallet.balance} />
            </span>
            <span className="stat-label">Монеты</span>
          </span>
        </span>
        {(!neverStaked(wallet) || wallet.best > wallet.balance) && (
          <span className="wallet-card-side">
            {wallet.best > wallet.balance && (
              <span>
                Рекорд <b>{formatCoins(wallet.best)}</b>
              </span>
            )}
            {wallet.won > 0 && (
              <span>
                Выиграно <b className="good">+{formatCoins(wallet.won)}</b>
              </span>
            )}
            {wallet.lost > 0 && (
              <span>
                Проиграно <b className="bad">−{formatCoins(wallet.lost)}</b>
              </span>
            )}
          </span>
        )}
      </m.div>

      {games === 0 ? (
        <m.div className="profile-empty" variants={sheetItem}>
          <span>Сыграйте первую партию</span>
          {onPlay && (
            <m.button type="button" className="primary" whileTap={{ scale: 0.96 }} onClick={onPlay}>
              Играть
            </m.button>
          )}
        </m.div>
      ) : (
        <>
          <m.div className="ring-wrap" variants={sheetItem}>
            <svg viewBox="0 0 120 120" className="ring" aria-hidden="true">
              <circle cx="60" cy="60" r={R} className="ring-track" />
              <m.circle
                cx="60"
                cy="60"
                r={R}
                className="ring-fill"
                strokeDasharray={C}
                initial={{ strokeDashoffset: C }}
                animate={{ strokeDashoffset: C * (1 - rate) }}
                transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1], delay: 0.15 }}
              />
            </svg>
            <div className="ring-label">
              <span className="ring-num">
                <CountUp value={Math.round(rate * 100)} />%
              </span>
              <span className="ring-sub">побед</span>
            </div>
          </m.div>

          <m.p className="score-line" variants={sheetItem} aria-label={`Побед ${stats.wins}, был дураком ${stats.losses}, ничьих ${stats.draws}`}>
            <b className="good">
              <CountUp value={stats.wins} />
            </b>
            <span className="muted"> / </span>
            <b className="bad">
              <CountUp value={stats.losses} />
            </b>
            <span className="muted"> / </span>
            <b>
              <CountUp value={stats.draws} />
            </b>
            <small className="muted">победы · дурак · ничьи</small>
          </m.p>

          <m.div className="stat-tiles two" variants={sheetItem}>
            <div className="stat">
              <span className="stat-num">
                <CountUp value={stats.streak} />
              </span>
              <span className="stat-label">Серия без «дурака»</span>
            </div>
            <div className="stat">
              <span className="stat-num">
                <CountUp value={stats.bestStreak} />
              </span>
              <span className="stat-label">Лучшая серия</span>
            </div>
          </m.div>
        </>
      )}

      <Breakdown by={stats.by} />

      {stats.history.length > 0 && (
        <m.ul className="history" variants={sheetItem} aria-label="Последние партии">
          {stats.history.slice(0, 10).map((h) => (
            <li key={h.at} className={h.result}>
              <span className="dot" />
              <span>
                {RESULT_TEXT[h.result]}
                <br />
                <span className="meta">{gameNote(h)}</span>
              </span>
              <time>{when(h.at)}</time>
            </li>
          ))}
        </m.ul>
      )}

      {games > 0 && (
        <m.div className="stat-foot" variants={sheetItem}>
          <span className="muted">Сыграно партий: {games}</span>
          {confirm ? (
            <m.span className="confirm" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}>
              <button type="button" className="link" onClick={() => setConfirm(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="link danger-link"
                onClick={() => {
                  onReset()
                  setConfirm(false)
                }}
              >
                Обнулить
              </button>
            </m.span>
          ) : (
            <button type="button" className="link" onClick={() => setConfirm(true)}>
              Сбросить статистику
            </button>
          )}
        </m.div>
      )}
    </Sheet>
  )
}
