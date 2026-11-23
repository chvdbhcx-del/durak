import { animate, AnimatePresence, m, useMotionValue, useTransform } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { Suit } from '../engine/cards'
import { AVATARS, cleanName, type HistoryEntry, type Settings, type Stats } from './settings'
import { Coin } from './Money'
import { formatCoins, neverStaked, type Wallet } from './wallet'
import { AvatarPicker, plural } from './pickers'
import { Sheet, sheetItem } from './Sheet'
import { SuitIcon } from './SuitIcon'

const RULES: { suit: Suit; title: string; text: string }[] = [
  { suit: 'S', title: 'Цель', text: 'Избавиться от всех карт. Кто остался с картами последним, тот дурак.' },
  { suit: 'H', title: 'Козырь', text: 'Масть открытой карты под колодой. Козырь бьёт любую карту другой масти.' },
  { suit: 'D', title: 'Атака', text: 'Ходящий кладёт любую карту. Первым ходит тот, у кого самый младший козырь.' },
  { suit: 'C', title: 'Защита', text: 'Покрыть можно старшей картой той же масти или козырем. Не можете — берите.' },
  { suit: 'H', title: 'Подкидывание', text: 'Остальные подкидывают карты того же достоинства, что уже лежат на столе, в любой момент, даже пока защитник ещё отбивается. Не больше, чем карт у защитника, и максимум шесть.' },
  { suit: 'S', title: 'Перевод', text: 'В переводном, пока ничего не покрыто, можно положить карту того же достоинства и передать атаку следующему.' },
  { suit: 'D', title: 'Бито и добор', text: 'Отбился — карты уходят в бито, и ходите вы. После хода все добирают до шести.' },
  { suit: 'C', title: 'Конец игры', text: 'Когда колода кончилась, игроки без карт выходят. Если последние карты ушли одновременно, это ничья.' },
]

export function RulesPanel({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Правила" onClose={onClose} wide>
      <div className="rules">
        {RULES.map((r, i) => (
          <m.article key={r.title} className="rule" variants={sheetItem} whileHover={{ y: -3 }}>
            <span className={`rule-suit ${r.suit === 'H' || r.suit === 'D' ? 'red' : ''}`} aria-hidden="true">
              <SuitIcon suit={r.suit} size="100%" />
            </span>
            <span className="rule-step">{i + 1}</span>
            <h3>{r.title}</h3>
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
