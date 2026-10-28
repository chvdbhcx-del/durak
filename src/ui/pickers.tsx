import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import type { DeckSize } from '../engine/cards'
import type { Mode } from '../engine/game'
import type { Speed, Theme } from './settings'
import { sheetItem } from './Sheet'
import { SuitIcon } from './SuitIcon'

export const BOT_NAMES = ['Лиса', 'Мишка', 'Сова', 'Ёж', 'Волк']

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** A selectable tile; the highlight ring slides between tiles of the same group. */
export function Tile({ group, on, disabled, onClick, children, label, className = '' }: { group: string; on: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; label: string; className?: string }) {
  return (
    <motion.button
      type="button"
      className={`tile ${on ? 'on' : ''} ${className}`}
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      whileHover={disabled ? undefined : { y: -2 }}
    >
      {on && <motion.span layoutId={`ring-${group}`} className="tile-ring" transition={{ type: 'spring', stiffness: 480, damping: 36 }} />}
      {children}
    </motion.button>
  )
}

export function Group({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
  return (
    <motion.section className="group" variants={sheetItem}>
      <header className="group-head">
        <span className="group-title">{title}</span>
        {value && (
          <motion.span key={value} className="group-value" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
            {value}
          </motion.span>
        )}
      </header>
      {children}
    </motion.section>
  )
}

function MiniCard({ rank, suit, red, tilt = 0, x = 0 }: { rank: string; suit: 'S' | 'H' | 'D' | 'C'; red?: boolean; tilt?: number; x?: number }) {
  return (
    <span className={`mini-face ${red ? 'red' : ''}`} style={{ rotate: `${tilt}deg`, translate: `${x}px 0` }}>
      <b>{rank}</b>
      <SuitIcon suit={suit} />
    </span>
  )
}

export function ModePicker({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const modes: { value: Mode; title: string; note: string }[] = [
    { value: 'podkidnoy', title: 'Подкидной', note: 'Подкидывайте карты того же достоинства' },
    { value: 'perevodnoy', title: 'Переводной', note: 'Отбивающийся может перевести ход дальше' },
  ]
  return (
    <Group title="Игра">
      <div className="tiles two">
        {modes.map((m) => (
          <Tile key={m.value} group="mode" on={value === m.value} onClick={() => onChange(m.value)} label={m.title}>
            <span className="mode-art" aria-hidden="true">
              {m.value === 'podkidnoy' ? (
                <>
                  <MiniCard rank="7" suit="H" red tilt={-8} x={-10} />
                  <MiniCard rank="7" suit="S" tilt={8} x={10} />
                  <span className="art-badge">+</span>
                </>
              ) : (
                <>
                  <MiniCard rank="9" suit="D" red tilt={-6} x={-14} />
                  <span className="art-arrow">→</span>
                  <MiniCard rank="9" suit="C" tilt={6} x={14} />
                </>
              )}
            </span>
            <span className="tile-title">{m.title}</span>
            <span className="tile-note">{m.note}</span>
          </Tile>
        ))}
      </div>
    </Group>
  )
}

export function OpponentsPicker({ value, max, onChange, title = 'Соперники', names = BOT_NAMES }: { value: number; max: number; onChange: (n: number) => void; title?: string; names?: string[] }) {
  return (
    <Group title={title} value={`${value} ${plural(value, 'соперник', 'соперника', 'соперников')}`}>
      <div className="avatars" role="radiogroup" aria-label="Число соперников">
        {names.slice(0, 5).map((name, i) => {
          const n = i + 1
          const on = n <= value
          const disabled = n > max
          return (
            <motion.button
              key={name + i}
              type="button"
              role="radio"
              aria-checked={n === value}
              aria-label={`${n} ${plural(n, 'соперник', 'соперника', 'соперников')}`}
              className={`avatar-pick ${on ? 'on' : ''}`}
              disabled={disabled}
              onClick={() => onChange(n)}
              whileTap={disabled ? undefined : { scale: 0.9 }}
              animate={{ scale: on ? 1 : 0.88, opacity: disabled ? 0.25 : on ? 1 : 0.55 }}
              transition={{ type: 'spring', stiffness: 500, damping: 26, delay: on ? i * 0.03 : 0 }}
            >
              <span className="avatar-circle">{name[0]}</span>
              <span className="avatar-name">{name}</span>
            </motion.button>
          )
        })}
      </div>
    </Group>
  )
}

export function DeckPicker({ value, onChange }: { value: DeckSize; onChange: (d: DeckSize) => void }) {
  const decks: { value: DeckSize; from: string }[] = [
    { value: 24, from: '9' },
    { value: 36, from: '6' },
    { value: 52, from: '2' },
  ]
  return (
    <Group title="Колода">
      <div className="tiles three">
        {decks.map((d) => (
          <Tile key={d.value} group="deck" on={value === d.value} onClick={() => onChange(d.value)} label={`${d.value} карт`}>
            <span className="deck-art" aria-hidden="true">
              {[0, 1, 2].map((k) => (
                <span key={k} className="deck-art-card" style={{ translate: `${k * 3}px ${-k * 3}px` }} />
              ))}
            </span>
            <span className="tile-big">{d.value}</span>
            <span className="tile-note">от {d.from} до туза</span>
          </Tile>
        ))}
      </div>
    </Group>
  )
}

export function SpeedPicker({ value, onChange }: { value: Speed; onChange: (s: Speed) => void }) {
  const speeds: { value: Speed; title: string; bars: number }[] = [
    { value: 'calm', title: 'Спокойно', bars: 1 },
    { value: 'normal', title: 'Обычно', bars: 2 },
    { value: 'fast', title: 'Быстро', bars: 3 },
  ]
  return (
    <Group title="Скорость ботов">
      <div className="tiles three">
        {speeds.map((s) => (
          <Tile key={s.value} group="speed" on={value === s.value} onClick={() => onChange(s.value)} label={s.title}>
            <span className="speed-art" aria-hidden="true">
              {[1, 2, 3].map((b) => (
                <span key={b} className={b <= s.bars ? 'lit' : ''} />
              ))}
            </span>
            <span className="tile-title">{s.title}</span>
          </Tile>
        ))}
      </div>
    </Group>
  )
}

export function ThemePicker({ value, onChange }: { value: Theme; onChange: (t: Theme) => void }) {
  const themes: { value: Theme; title: string }[] = [
    { value: 'system', title: 'Авто' },
    { value: 'dark', title: 'Тёмная' },
    { value: 'light', title: 'Светлая' },
  ]
  return (
    <Group title="Тема">
      <div className="tiles three">
        {themes.map((t) => (
          <Tile key={t.value} group="theme" on={value === t.value} onClick={() => onChange(t.value)} label={t.title}>
            <span className={`theme-art ${t.value}`} aria-hidden="true">
              <span className="theme-felt" />
              <span className="theme-card" />
            </span>
            <span className="tile-title">{t.title}</span>
          </Tile>
        ))}
      </div>
    </Group>
  )
}
