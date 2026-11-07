import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { maxPlayers } from '../engine/game'
import { Group, HAPTICS_ICON, LookPicker, SOUND_ICON, SpeedPicker, Switch, ThemePicker } from './pickers'
import type { Settings } from './settings'
import { AutoHeight, Sheet, sheetItem } from './Sheet'

export function withValidOpponents(s: Settings): Settings {
  return { ...s, opponents: Math.min(s.opponents, maxPlayers(s.deckSize) - 1) }
}

type Tab = 'game' | 'look' | 'sound'
const TABS: { id: Tab; label: string }[] = [
  { id: 'game', label: 'Игра' },
  { id: 'look', label: 'Вид' },
  { id: 'sound', label: 'Звук' },
]
// The last open section is remembered while the app runs.
let lastTab: Tab = 'game'

function Tabs({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  return (
    <motion.div className="tabs" role="tablist" variants={sheetItem}>
      {TABS.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'on' : ''}`} onClick={() => onChange(t.id)}>
          {value === t.id && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span>{t.label}</span>
        </button>
      ))}
    </motion.div>
  )
}

function ServerField({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <Group title="Сервер комнат" value={value.trim() ? 'свой' : 'общий'}>
      <input className="profile-name" value={value} placeholder="Общий (оставьте пустым)" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="Адрес сервера комнат" onChange={(e) => onChange(e.target.value)} />
    </Group>
  )
}

// Pages pass the sheet's reveal on to their rows, so every picker still slides in.
const page = {
  variants: { hidden: { opacity: 0, x: 16 }, shown: { opacity: 1, x: 0, transition: { duration: 0.18, staggerChildren: 0.04 } } },
  initial: 'hidden',
  animate: 'shown',
  exit: { opacity: 0, x: -16, transition: { duration: 0.15 } },
} as const
// The height itself is animated by AutoHeight around it; the fold only fades.
const fold = {
  variants: { hidden: { opacity: 0, y: -8 }, shown: { opacity: 1, y: 0, transition: { duration: 0.25, staggerChildren: 0.04 } } },
  initial: 'hidden',
  animate: 'shown',
  exit: { opacity: 0, transition: { duration: 0.15 } },
} as const

/** Settings from the main menu: preferences only, split into sections. A game is set up on the "Играть" screen. */
export function SettingsPanel({ settings, onChange, onClose }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(lastTab)
  useEffect(() => {
    lastTab = tab
  }, [tab])
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })

  return (
    <Sheet title="Настройки" onClose={onClose}>
      <Tabs value={tab} onChange={setTab} />
      <AutoHeight>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={tab} className="tab-page" {...page}>
          {tab === 'game' && (
            <>
              <SpeedPicker value={settings.speed} onChange={(speed) => set({ speed })} />
              <ServerField value={settings.server} onChange={(server) => set({ server })} />
            </>
          )}
          {tab === 'look' && (
            <>
              <ThemePicker value={settings.theme} onChange={(theme) => set({ theme })} />
              <LookPicker back={settings.cardBack} table={settings.tableStyle} onBack={(cardBack) => set({ cardBack })} onTable={(tableStyle) => set({ tableStyle })} />
            </>
          )}
          {tab === 'sound' && (
            <div className="switches">
              <Switch label="Звук карт" icon={SOUND_ICON} value={settings.sound} onChange={(sound) => set({ sound })} />
              <Switch label="Вибрация" icon={HAPTICS_ICON} value={settings.haptics} onChange={(haptics) => set({ haptics })} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      </AutoHeight>
    </Sheet>
  )
}

interface GameMenuProps {
  settings: Settings
  onChange: (s: Settings) => void
  onClose: () => void
  onRules: () => void
  onExit: () => void
  /** a room with other people: leaving takes a second tap, and the game doesn't stop while the menu is open */
  online: boolean
  /** bots at this table move on this device, so their speed can be changed here */
  botSpeed: boolean
}

/**
 * The menu during a game: only what makes sense mid-hand. No game setup and no "play with bots":
 * the mode, deck and opponents belong to the next game, and are picked before it starts.
 */
export function GameMenu({ settings, onChange, onClose, onRules, onExit, online, botSpeed }: GameMenuProps) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  const [look, setLook] = useState(false)
  const [sure, setSure] = useState(false)
  const sureTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(sureTimer.current), [])
  const exit = () => {
    if (online && !sure) {
      setSure(true)
      sureTimer.current = setTimeout(() => setSure(false), 3000)
      return
    }
    onClose()
    onExit()
  }

  return (
    <Sheet title={online ? 'Меню' : 'Пауза'} onClose={onClose}>
      <motion.div className="game-menu-actions" variants={sheetItem}>
        <motion.button type="button" className="primary big" whileTap={{ scale: 0.96 }} autoFocus onClick={onClose}>
          Вернуться в игру
        </motion.button>
        <div className="game-menu-row">
          <motion.button type="button" className="ghost big" whileTap={{ scale: 0.96 }} onClick={onRules}>
            Правила
          </motion.button>
          <motion.button type="button" className={`${online ? 'danger' : 'ghost'} big`} whileTap={{ scale: 0.96 }} onClick={exit}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={sure ? 'sure' : 'exit'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                {online ? (sure ? 'Точно выйти?' : 'Выйти из комнаты') : 'В главное меню'}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>
      </motion.div>

      <div className="switches">
        <Switch label="Звук карт" icon={SOUND_ICON} value={settings.sound} onChange={(sound) => set({ sound })} />
        <Switch label="Вибрация" icon={HAPTICS_ICON} value={settings.haptics} onChange={(haptics) => set({ haptics })} />
      </div>
      {botSpeed && <SpeedPicker value={settings.speed} onChange={(speed) => set({ speed })} />}

      <motion.button type="button" className="disclose" aria-expanded={look} variants={sheetItem} onClick={() => setLook((v) => !v)}>
        <span>Оформление</span>
        <motion.svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" animate={{ rotate: look ? 180 : 0 }}>
          <path fill="currentColor" d="M5.3 8.3a1 1 0 0 1 1.4 0L12 13.6l5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4z" />
        </motion.svg>
      </motion.button>
      <AutoHeight>
      <AnimatePresence initial={false}>
        {look && (
          <motion.div key="look" className="tab-page" {...fold}>
            <ThemePicker value={settings.theme} onChange={(theme) => set({ theme })} />
            <LookPicker back={settings.cardBack} table={settings.tableStyle} onBack={(cardBack) => set({ cardBack })} onTable={(tableStyle) => set({ tableStyle })} />
          </motion.div>
        )}
      </AnimatePresence>
      </AutoHeight>
    </Sheet>
  )
}
