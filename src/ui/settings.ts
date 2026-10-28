import type { DeckSize } from '../engine/cards'
import type { Mode } from '../engine/game'

export type Theme = 'system' | 'dark' | 'light'
export type Speed = 'calm' | 'normal' | 'fast'

export interface Settings {
  opponents: number
  deckSize: DeckSize
  mode: Mode
  theme: Theme
  speed: Speed
}

export interface Stats {
  wins: number
  losses: number
  draws: number
}

export const DEFAULT_SETTINGS: Settings = { opponents: 2, deckSize: 36, mode: 'podkidnoy', theme: 'system', speed: 'normal' }
export const BOT_DELAY: Record<Speed, number> = { calm: 1100, normal: 700, fast: 380 }

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
export const loadStats = () => read<Stats>('durak.stats', { wins: 0, losses: 0, draws: 0 })
export const saveStats = (s: Stats) => write('durak.stats', s)

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}
