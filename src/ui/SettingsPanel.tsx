import { App as NativeApp } from '@capacitor/app'
import { AnimatePresence, m } from 'framer-motion'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { maxPlayers } from '../engine/game'
import { parseServer } from '../net/room'
import { hasHaptics, isNative } from './native'
import { Group, HAPTICS_ICON, IconToggle, LookPicker, SOUND_ICON, SpeedPicker, ThemePicker } from './pickers'
import type { Settings } from './settings'
import { AutoHeight, Sheet, sheetItem } from './Sheet'
import { type UpdateLog, watchUpdateLog, WEB_VERSION } from './updates'
import { formatCoins, START_BALANCE } from './wallet'

export function withValidOpponents(s: Settings): Settings {
  return { ...s, opponents: Math.min(s.opponents, maxPlayers(s.deckSize) - 1) }
}

// The height itself is animated by AutoHeight around it; the fold only fades.
const fold = {
  variants: { hidden: { opacity: 0, y: -8 }, shown: { opacity: 1, y: 0, transition: { duration: 0.25, staggerChildren: 0.04 } } },
  initial: 'hidden',
  animate: 'shown',
  exit: { opacity: 0, transition: { duration: 0.15 } },
} as const

const CHEVRON = 'M5.3 8.3a1 1 0 0 1 1.4 0L12 13.6l5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4z'

/** A section folded away by default, under a quiet header line. */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <m.button type="button" className="disclose" aria-expanded={open} variants={sheetItem} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <m.svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" animate={{ rotate: open ? 180 : 0 }}>
          <path fill="currentColor" d={CHEVRON} />
        </m.svg>
      </m.button>
      <AutoHeight>
        <AnimatePresence initial={false}>
          {open && (
            <m.div key="fold" className="tab-page" {...fold}>
              {children}
            </m.div>
          )}
        </AnimatePresence>
      </AutoHeight>
    </>
  )
}

type Check = 'idle' | 'checking' | 'ok' | 'fail' | 'bad'

/** Asks a PeerJS server for a fresh id: the cheapest call that proves it is there and answers this app. */
async function pingServer(raw: string): Promise<boolean> {
  const s = parseServer(raw)
  if (!s) return false
  const base = `${s.secure ? 'https' : 'http'}://${s.host}:${s.port}${s.path === '/' ? '' : s.path}`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 6000)
  try {
    const r = await fetch(`${base}/peerjs/id?ts=${Date.now()}`, { signal: ctl.signal, cache: 'no-store' })
    return r.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

const CHECK_TEXT: Record<Check, string> = {
  idle: '',
  checking: 'Проверяем…',
  ok: 'Сервер отвечает',
  fail: 'Не удалось подключиться. Адрес сохранён',
  bad: 'Не похоже на адрес сервера',
}

/** The private room server: typed into a draft and applied only on "Сохранить", so a typo never breaks online play mid-word. */
function ServerField({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [check, setCheck] = useState<Check>('idle')
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])
  const dirty = draft.trim() !== value.trim()
  const save = async () => {
    const next = draft.trim()
    if (next && !parseServer(next)) return setCheck('bad')
    onChange(next)
    setDraft(next)
    if (!next) return setCheck('idle')
    setCheck('checking')
    const ok = await pingServer(next)
    if (alive.current) setCheck(ok ? 'ok' : 'fail')
  }
  return (
    <Group title="Сервер комнат" value={value.trim() ? 'свой' : 'общий'}>
      <div className="server-row">
        <input
          className="profile-name"
          value={draft}
          placeholder="Общий"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Адрес сервера комнат"
          onChange={(e) => {
            setDraft(e.target.value)
            setCheck('idle')
          }}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        {dirty && (
          <button type="button" className="primary" onClick={save}>
            Сохранить
          </button>
        )}
      </div>
      {(check !== 'idle' || value.trim()) && (
        <p className={`server-note ${check === 'ok' ? 'good' : check === 'fail' || check === 'bad' ? 'bad' : ''}`} role="status">
          {CHECK_TEXT[check]}
          {value.trim() && (
            <button
              type="button"
              className="link"
              onClick={() => {
                onChange('')
                setDraft('')
                setCheck('idle')
              }}
            >
              Сбросить на общий
            </button>
          )}
        </p>
      )}
    </Group>
  )
}

/** The installed APK's version, which over-the-air updates leave behind the game's own version. */
function useApkVersion() {
  const [apkVersion, setApkVersion] = useState('')
  useEffect(() => {
    if (isNative) NativeApp.getInfo().then((i) => setApkVersion(i.version)).catch(() => {})
  }, [])
  return apkVersion
}

function About() {
  const apk = useApkVersion()
  const [log, setLog] = useState<UpdateLog | null>(null)
  useEffect(() => watchUpdateLog(setLog), [])
  return (
    <m.div className="about" variants={sheetItem}>
      <span>
        Версия {WEB_VERSION}
        {apk && apk !== WEB_VERSION && ` · APK ${apk}`}
      </span>
      {log && <span className="muted">{log.text}</span>}
      <span className="muted">Монеты и счёт хранятся только на этом устройстве: если удалить приложение или данные сайта, они обнулятся.</span>
    </m.div>
  )
}

/** "Начать заново": statistics and coins back to the start, after a second tap. */
function StartOver({ onStartOver }: { onStartOver: () => void }) {
  const [sure, setSure] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <m.button
      type="button"
      className={`${sure ? 'danger' : 'ghost'} big`}
      variants={sheetItem}
      whileTap={{ scale: 0.96 }}
      onClick={() => {
        if (!sure) {
          setSure(true)
          timer.current = setTimeout(() => setSure(false), 4000)
          return
        }
        clearTimeout(timer.current)
        setSure(false)
        onStartOver()
      }}
    >
      {sure ? `Стереть всё и вернуть ${formatCoins(START_BALANCE)}?` : 'Начать заново'}
    </m.button>
  )
}

/** Sound and vibration as two icon buttons in one row; vibration only where the device can vibrate. */
function QuickToggles({ settings, set }: { settings: Settings; set: (p: Partial<Settings>) => void }) {
  return (
    <m.div className="quick-toggles" variants={sheetItem}>
      <IconToggle label="Звук" icon={SOUND_ICON} value={settings.sound} onChange={(sound) => set({ sound })} />
      {hasHaptics && <IconToggle label="Вибрация" icon={HAPTICS_ICON} value={settings.haptics} onChange={(haptics) => set({ haptics })} />}
    </m.div>
  )
}

/**
 * Settings from the main menu, on one screen in order of use: sound, the look, bot speed,
 * and the rarely needed things folded under "Дополнительно". A game is set up before it starts.
 */
export function SettingsPanel({ settings, onChange, onClose, onStartOver }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void; onStartOver: () => void }) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  return (
    <Sheet title="Настройки" onClose={onClose}>
      <QuickToggles settings={settings} set={set} />
      <ThemePicker value={settings.theme} onChange={(theme) => set({ theme })} />
      <LookPicker back={settings.cardBack} table={settings.tableStyle} face={settings.cardFace} onBack={(cardBack) => set({ cardBack })} onTable={(tableStyle) => set({ tableStyle })} onFace={(cardFace) => set({ cardFace })} />
      <SpeedPicker value={settings.speed} onChange={(speed) => set({ speed })} />
      <Fold title="Дополнительно">
        <ServerField value={settings.server} onChange={(server) => set({ server })} />
        <About />
        <StartOver onStartOver={onStartOver} />
      </Fold>
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
  /** coins this room game holds, lost on leaving it */
  roomStake?: number
}

/**
 * The menu during a game: only what makes sense mid-hand. No game setup and no look:
 * those belong to the next game and to the main settings.
 */
export function GameMenu({ settings, onChange, onClose, onRules, onExit, online, botSpeed, roomStake = 0 }: GameMenuProps) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
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
  const sureText = roomStake > 0 ? `Ставка ${formatCoins(roomStake)} сгорит. Выйти?` : 'Точно выйти?'

  return (
    <Sheet title={online ? 'Меню' : 'Пауза'} onClose={onClose}>
      <m.div className="game-menu-actions" variants={sheetItem}>
        <m.button type="button" className="primary big" whileTap={{ scale: 0.96 }} autoFocus onClick={onClose}>
          Вернуться в игру
        </m.button>
        <div className="game-menu-row">
          <m.button type="button" className="ghost big" whileTap={{ scale: 0.96 }} onClick={onRules}>
            Правила
          </m.button>
          <m.button type="button" className={`${online ? 'danger' : 'ghost'} big`} whileTap={{ scale: 0.96 }} onClick={exit}>
            <AnimatePresence mode="wait" initial={false}>
              <m.span key={sure ? 'sure' : 'exit'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                {online ? (sure ? sureText : 'Выйти из комнаты') : 'В главное меню'}
              </m.span>
            </AnimatePresence>
          </m.button>
        </div>
      </m.div>

      <QuickToggles settings={settings} set={set} />
      {botSpeed && <SpeedPicker value={settings.speed} onChange={(speed) => set({ speed })} />}
    </Sheet>
  )
}
