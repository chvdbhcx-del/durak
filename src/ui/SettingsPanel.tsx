import { AnimatePresence, motion } from 'framer-motion'
import { useEffect } from 'react'
import type { DeckSize } from '../engine/cards'
import { maxPlayers, Mode } from '../engine/game'
import type { Settings, Speed, Stats, Theme } from './settings'

interface Props {
  settings: Settings
  stats: Stats
  onChange: (s: Settings) => void
  onStart: (s: Settings) => void
  onClose: () => void
  onResetStats: () => void
}

// The sheet reveals its rows one after another.
const list = { hidden: {}, shown: { transition: { staggerChildren: 0.04, delayChildren: 0.08 } } }
const item = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 32 } },
} as const

function Segmented<T extends string | number>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: T
  options: { value: T; label: string; disabled?: boolean; hint?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <motion.div className="field" role="radiogroup" aria-labelledby={`${id}-label`} variants={item}>
      <span id={`${id}-label`} className="field-label">
        {label}
      </span>
      <div className="segmented">
        {options.map((o) => (
          <button
            key={String(o.value)}
            id={`${id}-${o.value}`}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? 'on' : ''}
            disabled={o.disabled}
            title={o.hint}
            onClick={() => onChange(o.value)}
          >
            {o.value === value && <motion.span layoutId={`seg-${id}`} className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
            <span className="seg-label">{o.label}</span>
          </button>
        ))}
      </div>
    </motion.div>
  )
}

export function SettingsPanel({ settings, stats, onChange, onStart, onClose, onResetStats }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    next.opponents = Math.min(next.opponents, maxPlayers(next.deckSize) - 1)
    onChange(next)
  }
  const maxOpp = maxPlayers(settings.deckSize) - 1

  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        initial={{ y: 40, scale: 0.96, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 30, scale: 0.97, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <motion.div className="sheet-body" variants={list} initial="hidden" animate="shown">
        <motion.div className="sheet-head" variants={item}>
          <h2 id="settings-title">Настройки партии</h2>
          <motion.button type="button" className="icon" aria-label="Закрыть" whileTap={{ scale: 0.88, rotate: 90 }} whileHover={{ rotate: 90 }} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="currentColor" d="M6.3 5 12 10.6 17.7 5 19 6.3 13.4 12l5.6 5.7-1.3 1.3-5.7-5.6L6.3 19 5 17.7l5.6-5.7L5 6.3z" />
            </svg>
          </motion.button>
        </motion.div>

        <Segmented<Mode>
          id="mode"
          label="Игра"
          value={settings.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'podkidnoy', label: 'Подкидной' },
            { value: 'perevodnoy', label: 'Переводной' },
          ]}
        />
        <motion.div variants={item}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={settings.mode} className="field-note" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
              {settings.mode === 'podkidnoy'
                ? 'Подкидывать можно карты того же достоинства, что уже лежат на столе.'
                : 'Пока карты не покрыты, отбивающийся может перевести ход картой того же достоинства.'}
            </motion.p>
          </AnimatePresence>
        </motion.div>

        <Segmented<number>
          id="opponents"
          label="Соперники"
          value={settings.opponents}
          onChange={(opponents) => set({ opponents })}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n), disabled: n > maxOpp, hint: n > maxOpp ? 'Для такой колоды слишком много игроков' : undefined }))}
        />

        <Segmented<DeckSize>
          id="deck"
          label="Колода"
          value={settings.deckSize}
          onChange={(deckSize) => set({ deckSize })}
          options={[
            { value: 24, label: '24 карты' },
            { value: 36, label: '36 карт' },
            { value: 52, label: '52 карты' },
          ]}
        />

        <Segmented<Speed>
          id="speed"
          label="Скорость ботов"
          value={settings.speed}
          onChange={(speed) => set({ speed })}
          options={[
            { value: 'calm', label: 'Спокойно' },
            { value: 'normal', label: 'Обычно' },
            { value: 'fast', label: 'Быстро' },
          ]}
        />

        <Segmented<Theme>
          id="theme"
          label="Тема"
          value={settings.theme}
          onChange={(theme) => set({ theme })}
          options={[
            { value: 'system', label: 'Как в системе' },
            { value: 'dark', label: 'Тёмная' },
            { value: 'light', label: 'Светлая' },
          ]}
        />

        <motion.div className="sheet-foot" variants={item}>
          <span className="muted">
            {stats.wins} побед · {stats.losses} поражений · {stats.draws} ничьих{' '}
            <button type="button" className="link" onClick={onResetStats}>
              Сбросить
            </button>
          </span>
          <motion.button type="button" className="primary" whileTap={{ scale: 0.95 }} onClick={() => onStart(settings)}>
            Начать заново
          </motion.button>
        </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
