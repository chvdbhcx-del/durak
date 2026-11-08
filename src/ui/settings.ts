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
  /** address of a private room server; empty means the public one */
  server: string
  /** games in a bot tournament; 1 means a single game */
  series: number
  /** coins at stake in bot games, one of STAKES */
  stake: number
}

export interface HistoryEntry {
  /** timestamp, ms */
  at: number
  result: 'win' | 'loss' | 'draw'
  mode: Mode
  deck: number
  players: number
  online: boolean
  /** bot strength and cheater setting of that game; absent in older entries */
  level?: 'easy' | 'normal' | 'hard'
  cheat?: boolean
}

/** Wins, losses and draws for one slice of the games. */
export type Tally = [wins: number, losses: number, draws: number]

export interface Stats {
  wins: number
  losses: number
  draws: number
  /** current run of games without being the fool */
  streak: number
  bestStreak: number
  /** newest first, capped at HISTORY_LIMIT */
  history: HistoryEntry[]
  /** running totals per slice, keyed like `mode:podkidnoy`, `level:hard`, `rules:cheat`, `where:online`; games before this existed are not in them */
  by?: Record<string, Tally>
}

/** The slices a finished game belongs to. */
export function slicesOf(e: Pick<HistoryEntry, 'mode' | 'online' | 'level' | 'cheat'>): string[] {
  const out = [`mode:${e.mode}`, `rules:${e.cheat ? 'cheat' : 'classic'}`, `where:${e.online ? 'online' : 'bots'}`]
  if (!e.online && e.level) out.push(`level:${e.level}`)
  return out
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
    by: slicesOf(entry).reduce(
      (by, key) => {
        const [w, l, d] = by[key] ?? [0, 0, 0]
        by[key] = [w + (entry.result === 'win' ? 1 : 0), l + (entry.result === 'loss' ? 1 : 0), d + (entry.result === 'draw' ? 1 : 0)]
        return by
      },
      { ...(s.by ?? {}) },
    ),
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
  server: '',
  series: 1,
  stake: 100,
}
/** How long a bot "thinks" before a move, in ms. Each move varies around this. */
export const BOT_DELAY: Record<Speed, number> = { calm: 2600, normal: 1800, fast: 1000 }

// Storage can be missing or blocked (private windows, embedded previews), so every access is guarded.
function read<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? sanitize(fallback, JSON.parse(raw)) : fallback
  } catch {
    return fallback
  }
}

/**
 * Takes the saved fields whose type matches the defaults, so a value from an older or broken
 * version can never reach the game as, say, a string where a number belongs.
 */
export function sanitize<T extends object>(fallback: T, saved: unknown): T {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return fallback
  const out: Record<string, unknown> = { ...(fallback as Record<string, unknown>) }
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    if (!(k in fallback)) {
      out[k] = v
      continue
    }
    const want = (fallback as Record<string, unknown>)[k]
    if (want === null || v === null) {
      out[k] = v
      continue
    }
    if (typeof v === typeof want && Array.isArray(v) === Array.isArray(want) && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v
  }
  return out as T
}

const oneOf = <T,>(v: T, allowed: readonly T[], dflt: T) => (allowed.includes(v) ? v : dflt)

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

export function loadSettings(): Settings {
  const s = read<Settings>('durak.settings', DEFAULT_SETTINGS)
  const d = DEFAULT_SETTINGS
  return {
    ...s,
    deckSize: oneOf(s.deckSize, [24, 36, 52] as const, d.deckSize),
    mode: oneOf(s.mode, ['podkidnoy', 'perevodnoy'] as const, d.mode),
    theme: oneOf(s.theme, ['system', 'dark', 'light'] as const, d.theme),
    speed: oneOf(s.speed, ['calm', 'normal', 'fast'] as const, d.speed),
    difficulty: oneOf(s.difficulty, ['easy', 'normal', 'hard'] as const, d.difficulty),
    opponents: Math.max(1, Math.min(5, Math.round(s.opponents))),
    series: Math.max(1, Math.min(9, Math.round(s.series))),
    avatar: Math.max(0, Math.min(AVATARS.length - 1, Math.round(s.avatar))),
    cardBack: oneOf(s.cardBack, ['teal', 'ember', 'ink', 'rose'] as const, d.cardBack),
    tableStyle: oneOf(s.tableStyle, ['forest', 'night', 'wine', 'slate'] as const, d.tableStyle),
    name: s.name.slice(0, 16),
  }
}
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
      t = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('')
      localStorage.setItem('durak.token', t)
    }
    return t
  } catch {
    return Math.random().toString(36).slice(2)
  }
}
