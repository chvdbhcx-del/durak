import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { Suit } from '../engine/cards'
import { AVATARS, type HistoryEntry, type Settings, type Stats } from './settings'
import { AvatarPicker, LookPicker, plural } from './pickers'
import { Sheet, sheetItem } from './Sheet'
import { SuitIcon } from './SuitIcon'

const RULES: { suit: Suit; title: string; text: string }[] = [
  { suit: 'S', title: 'Цель', text: 'Избавиться от всех карт. Кто остался с картами последним, тот дурак.' },
  { suit: 'H', title: 'Козырь', text: 'Масть открытой карты под колодой. Козырь бьёт любую карту другой масти.' },
  { suit: 'D', title: 'Атака', text: 'Ходящий кладёт любую карту. Первым ходит тот, у кого самый младший козырь.' },
  { suit: 'C', title: 'Защита', text: 'Покрыть можно старшей картой той же масти или козырем. Не можете — берите.' },
  { suit: 'H', title: 'Подкидывание', text: 'Остальные подкидывают карты того же достоинства, что уже лежат на столе. Не больше, чем карт у защитника, и максимум шесть.' },
  { suit: 'S', title: 'Перевод', text: 'В переводном, пока ничего не покрыто, можно положить карту того же достоинства и передать атаку следующему.' },
  { suit: 'D', title: 'Бито и добор', text: 'Отбился — карты уходят в бито, и ходите вы. После хода все добирают до шести.' },
  { suit: 'C', title: 'Конец игры', text: 'Когда колода кончилась, игроки без карт выходят. Если последние карты ушли одновременно, это ничья.' },
]

export function RulesPanel({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Правила" onClose={onClose} wide>
      <div className="rules">
        {RULES.map((r, i) => (
          <motion.article key={r.title} className="rule" variants={sheetItem} whileHover={{ y: -3 }}>
            <span className={`rule-suit ${r.suit === 'H' || r.suit === 'D' ? 'red' : ''}`} aria-hidden="true">
              <SuitIcon suit={r.suit} size="100%" />
            </span>
            <span className="rule-step">{i + 1}</span>
            <h3>{r.title}</h3>
            <p>{r.text}</p>
          </motion.article>
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
  return <>{text}</>
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
    <motion.div className="breakdown" variants={sheetItem}>
      <h3>По режимам</h3>
      {rows.map(({ key, name, t, total }) => (
        <div key={key} className="bd-row">
          <span className="bd-name">{name}</span>
          <span className="bd-bar" aria-hidden="true">
            <motion.i initial={{ width: 0 }} animate={{ width: `${(t[0] / total) * 100}%` }} transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }} />
          </span>
          <span className="bd-num">
            {Math.round((t[0] / total) * 100)}% · {total}
          </span>
        </div>
      ))}
    </motion.div>
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

export function StatsPanel({ stats, settings, onSettings, onClose, onReset }: { stats: Stats; settings: Settings; onSettings: (s: Settings) => void; onClose: () => void; onReset: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const games = stats.wins + stats.losses + stats.draws
  const rate = games ? stats.wins / games : 0
  const R = 52
  const C = 2 * Math.PI * R

  return (
    <Sheet title="Профиль" onClose={onClose}>
      <motion.div className="profile-head" variants={sheetItem}>
        <motion.span key={settings.avatar} className="profile-avatar" initial={{ scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}>
          {AVATARS[settings.avatar] ?? AVATARS[0]}
        </motion.span>
        <input className="profile-name" value={settings.name} maxLength={16} aria-label="Имя" placeholder="Ваше имя" onChange={(e) => onSettings({ ...settings, name: e.target.value })} />
      </motion.div>
      <motion.div variants={sheetItem}>
        <AvatarPicker value={settings.avatar} onChange={(avatar) => onSettings({ ...settings, avatar })} />
      </motion.div>
      <LookPicker back={settings.cardBack} table={settings.tableStyle} onBack={(cardBack) => onSettings({ ...settings, cardBack })} onTable={(tableStyle) => onSettings({ ...settings, tableStyle })} />

      <motion.div className="ring-wrap" variants={sheetItem}>
        <svg viewBox="0 0 120 120" className="ring" aria-hidden="true">
          <circle cx="60" cy="60" r={R} className="ring-track" />
          <motion.circle
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
      </motion.div>

      <motion.div className="stat-tiles" variants={sheetItem}>
        <div className="stat good">
          <span className="stat-num">
            <CountUp value={stats.wins} />
          </span>
          <span className="stat-label">Победы</span>
        </div>
        <div className="stat bad">
          <span className="stat-num">
            <CountUp value={stats.losses} />
          </span>
          <span className="stat-label">Был дураком</span>
        </div>
        <div className="stat">
          <span className="stat-num">
            <CountUp value={stats.draws} />
          </span>
          <span className="stat-label">Ничьи</span>
        </div>
      </motion.div>

      <motion.div className="stat-tiles two" variants={sheetItem}>
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
      </motion.div>

      <Breakdown by={stats.by} />

      {stats.history.length > 0 && (
        <motion.ul className="history" variants={sheetItem} aria-label="Последние партии">
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
        </motion.ul>
      )}

      <motion.div className="stat-foot" variants={sheetItem}>
        <span className="muted">{games ? `Сыграно партий: ${games}` : 'Сыграйте первую партию, и здесь появится счёт.'}</span>
        {games > 0 &&
          (confirm ? (
            <motion.span className="confirm" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}>
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
            </motion.span>
          ) : (
            <button type="button" className="link" onClick={() => setConfirm(true)}>
              Сбросить счёт
            </button>
          ))}
      </motion.div>
    </Sheet>
  )
}
