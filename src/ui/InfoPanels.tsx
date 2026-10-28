import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { Suit } from '../engine/cards'
import type { Stats } from './settings'
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

export function StatsPanel({ stats, onClose, onReset }: { stats: Stats; onClose: () => void; onReset: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const games = stats.wins + stats.losses + stats.draws
  const rate = games ? stats.wins / games : 0
  const R = 52
  const C = 2 * Math.PI * R

  return (
    <Sheet title="Статистика" onClose={onClose}>
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
