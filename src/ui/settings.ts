import type { DeckSize } from '../engine/cards'
import type { Mode } from '../engine/game'

export type Theme = 'system' | 'dark' | 'light'
export type Speed = 'calm' | 'normal' | 'fast'
export type Difficulty = 'easy' | 'normal' | 'hard'
export type CardBack = 'teal' | 'ember' | 'ink' | 'rose'
export type TableStyle = 'forest' | 'night' | 'wine' | 'slate'

export const AVATARS = ['🦊', '🐻', '🦉', '🦔', '🐺', '🐱', '🐸', '🦄']

export interface Settings {
  opponents: number
  deckSize: DeckSize
  mode: Mode
  theme: Theme
  speed: Speed
  /** shown to friends in online games */
  name: string
  /** card sounds */
  sound: boolean
  /** "cheater" mode: cover with any card */
  cheat: boolean
  /** profile picture: index into AVATARS */
  avatar: number
  difficulty: Difficulty
  /** vibration on moves */
  haptics: boolean
  cardBack: CardBack
  tableStyle: TableStyle
}

export interface HistoryEntry {
  /** timestamp, ms */
  at: number
  result: 'win' | 'loss' | 'draw'
  mode: Mode
  deck: number
  players: number
  online: boolean
}

export interface Stats {
  wins: number
  losses: number
  draws: number
  /** current run of games without being the fool */
  streak: number
  bestStreak: number
  /** newest first, capped at HISTORY_LIMIT */
  history: HistoryEntry[]
}

export const HISTORY_LIMIT = 30
export const EMPTY_STATS: Stats = { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, history: [] }

/** Folds one finished game into the stats. */
export function addResult(s: Stats, entry: HistoryEntry): Stats {
  const streak = entry.result === 'loss' ? 0 : s.streak + (entry.result === 'win' ? 1 : 0)
  return {
    ...s,
    wins: s.wins + (entry.result === 'win' ? 1 : 0),
    losses: s.losses + (entry.result === 'loss' ? 1 : 0),
    draws: s.draws + (entry.result === 'draw' ? 1 : 0),
    streak,
    bestStreak: Math.max(s.bestStreak, streak),
    history: [entry, ...s.history].slice(0, HISTORY_LIMIT),
  }
}

export const DEFAULT_SETTINGS: Settings = {
  opponents: 2,
  deckSize: 36,
  mode: 'podkidnoy',
  theme: 'system',
  speed: 'normal',
  name: `Игрок ${10 + Math.floor(Math.random() * 90)}`,
  sound: true,
  cheat: false,
  avatar: Math.floor(Math.random() * AVATARS.length),
  difficulty: 'normal',
  haptics: true,
  cardBack: 'teal',
  tableStyle: 'forest',
}
/** How long a bot "thinks" before a move, in ms. Each move varies around this. */
export const BOT_DELAY: Record<Speed, number> = { calm: 2600, normal: 1800, fast: 1000 }

// Storage can be missing or blocked (private windows, embedded previews), so every access is guarded.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

export const loadSettings = () => read<Settings>('durak.settings', DEFAULT_SETTINGS)
export const saveSettings = (s: Settings) => write('durak.settings', s)
export const loadStats = () => read<Stats>('durak.stats', EMPTY_STATS)
export const saveStats = (s: Stats) => write('durak.stats', s)

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function applyLook(back: CardBack, table: TableStyle) {
  const root = document.documentElement
  root.setAttribute('data-back', back)
  root.setAttribute('data-table', table)
}

/** Identifies this device to a room host, so a dropped player gets their seat back. */
export function deviceToken(): string {
  try {
    let t = localStorage.getItem('durak.token')
    if (!t) {
      t = Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem('durak.token', t)
    }
    return t
  } catch {
    return Math.random().toString(36).slice(2)
  }
}
