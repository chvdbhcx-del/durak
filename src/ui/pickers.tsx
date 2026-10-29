import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import type { DeckSize } from '../engine/cards'
import type { Mode } from '../engine/game'
import { AVATARS, type CardBack, type Difficulty, type Speed, type TableStyle, type Theme } from './settings'
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

export function CheatPicker({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  const options: { value: boolean; title: string; note: string }[] = [
    { value: false, title: 'По правилам', note: 'Покрывать можно только старшей картой' },
    { value: true, title: 'Шулер', note: 'Кроете любой картой. Пойманный мухлевать больше не может. Боты замечают обман, и чем они сильнее, тем чаще (15, 30 или 50%), в том числе друг у друга. Вы ловите обман нажатием на карту' },
  ]
  return (
    <Group title="Шулер">
      <div className="tiles two">
        {options.map((o) => (
          <Tile key={String(o.value)} group="cheat" on={value === o.value} onClick={() => onChange(o.value)} label={o.title}>
            <span className={`cheat-art ${o.value ? 'on' : 'off'}`} aria-hidden="true">
              <MiniCard rank="6" suit="H" red tilt={-8} x={-10} />
              <MiniCard rank={o.value ? '6' : 'Т'} suit={o.value ? 'C' : 'H'} red={!o.value} tilt={8} x={10} />
              <span className="art-badge">{o.value ? '!' : '✓'}</span>
            </span>
            <span className="tile-title">{o.title}</span>
            <span className="tile-note">{o.note}</span>
          </Tile>
        ))}
      </div>
    </Group>
  )
}

export function SoundPicker({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  const options: { value: boolean; title: string; note: string }[] = [
    { value: true, title: 'Вкл', note: 'Шуршание карт' },
    { value: false, title: 'Выкл', note: 'Без звука' },
  ]
  return (
    <Group title="Звук">
      <div className="tiles two">
        {options.map((o) => (
          <Tile key={String(o.value)} group="sound" on={value === o.value} onClick={() => onChange(o.value)} label={o.title}>
            <span className={`sound-art ${o.value ? 'on' : 'off'}`} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28">
                <path fill="currentColor" d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4z" />
                {o.value ? (
                  <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
                ) : (
                  <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M16 9.5l5 5M21 9.5l-5 5" />
                )}
              </svg>
            </span>
            <span className="tile-title">{o.title}</span>
            <span className="tile-note">{o.note}</span>
          </Tile>
        ))}
      </div>
    </Group>
  )
}

export function DifficultyPicker({ value, onChange }: { value: Difficulty; onChange: (d: Difficulty) => void }) {
  const levels: { value: Difficulty; title: string; note: string; bars: number }[] = [
    { value: 'easy', title: 'Лёгкий', note: 'Часто ошибается', bars: 1 },
    { value: 'normal', title: 'Обычный', note: 'Играет разумно', bars: 2 },
    { value: 'hard', title: 'Сильный', note: 'Считает вышедшие карты', bars: 3 },
  ]
  return (
    <Group title="Сила ботов">
      <div className="tiles three">
        {levels.map((l) => (
          <Tile key={l.value} group="difficulty" on={value === l.value} onClick={() => onChange(l.value)} label={l.title}>
            <span className="speed-art" aria-hidden="true">
              {[1, 2, 3].map((b) => (
                <span key={b} className={b <= l.bars ? 'lit' : ''} />
              ))}
            </span>
            <span className="tile-title">{l.title}</span>
            <span className="tile-note">{l.note}</span>
          </Tile>
        ))}
      </div>
    </Group>
  )
}

export function HapticsPicker({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  const options: { value: boolean; title: string }[] = [
    { value: true, title: 'Вкл' },
    { value: false, title: 'Выкл' },
  ]
  return (
    <Group title="Вибрация">
      <div className="tiles two">
        {options.map((o) => (
          <Tile key={String(o.value)} group="haptics" on={value === o.value} onClick={() => onChange(o.value)} label={o.title}>
            <span className="tile-title">{o.title}</span>
          </Tile>
        ))}
      </div>
    </Group>
  )
}

export const CARD_BACKS: { value: CardBack; title: string; a: string; b: string }[] = [
  { value: 'teal', title: 'Изумруд', a: '#173a34', b: '#1f4d45' },
  { value: 'ember', title: 'Уголь', a: '#3b1f17', b: '#57301f' },
  { value: 'ink', title: 'Тушь', a: '#1c2540', b: '#2a3860' },
  { value: 'rose', title: 'Роза', a: '#3d1c2e', b: '#5a2a44' },
]

export const TABLES: { value: TableStyle; title: string; color: string }[] = [
  { value: 'forest', title: 'Сукно', color: '#183029' },
  { value: 'night', title: 'Ночь', color: '#1a2233' },
  { value: 'wine', title: 'Бордо', color: '#33191f' },
  { value: 'slate', title: 'Сланец', color: '#262b2e' },
]

export function LookPicker({ back, table, onBack, onTable }: { back: CardBack; table: TableStyle; onBack: (b: CardBack) => void; onTable: (t: TableStyle) => void }) {
  return (
    <>
      <Group title="Рубашка карт" value={CARD_BACKS.find((b) => b.value === back)?.title}>
        <div className="tiles four">
          {CARD_BACKS.map((b) => (
            <Tile key={b.value} group="back" on={back === b.value} onClick={() => onBack(b.value)} label={b.title}>
              <span className="swatch back" style={{ background: b.a, borderColor: b.b }} aria-hidden="true">
                <span style={{ background: b.b }} />
              </span>
            </Tile>
          ))}
        </div>
      </Group>
      <Group title="Стол" value={TABLES.find((t) => t.value === table)?.title}>
        <div className="tiles four">
          {TABLES.map((t) => (
            <Tile key={t.value} group="table" on={table === t.value} onClick={() => onTable(t.value)} label={t.title}>
              <span className="swatch table" style={{ background: t.color }} aria-hidden="true" />
            </Tile>
          ))}
        </div>
      </Group>
    </>
  )
}

export function AvatarPicker({ value, onChange }: { value: number; onChange: (i: number) => void }) {
  return (
    <div className="avatar-grid">
      {AVATARS.map((a, i) => (
        <motion.button key={a} type="button" className={`avatar-opt ${i === value ? 'on' : ''}`} aria-label={`Аватар ${a}`} aria-pressed={i === value} whileTap={{ scale: 0.9 }} onClick={() => onChange(i)}>
          {i === value && <motion.span layoutId="avatar-ring" className="tile-ring" transition={{ type: 'spring', stiffness: 480, damping: 36 }} />}
          <span>{a}</span>
        </motion.button>
      ))}
    </div>
  )
}

export function SeriesPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const options = [
    { value: 1, title: 'Одна партия', note: 'Сыграли и всё' },
    { value: 3, title: 'Турнир на 3', note: 'Больше всех дураком: проиграл' },
    { value: 5, title: 'Турнир на 5', note: 'Длинная серия' },
  ]
  return (
    <Group title="Турнир с ботами">
      <div className="tiles three">
        {options.map((o) => (
          <Tile key={o.value} group="series" on={value === o.value} onClick={() => onChange(o.value)} label={o.title}>
            <span className="series-art" aria-hidden="true">
              {Array.from({ length: o.value === 1 ? 1 : o.value }, (_, i) => (
                <span key={i} />
              ))}
            </span>
            <span className="tile-title">{o.title}</span>
            <span className="tile-note">{o.note}</span>
          </Tile>
        ))}
      </div>
    </Group>
  )
}
