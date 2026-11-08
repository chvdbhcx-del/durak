import { type Difficulty, sanitize } from './settings'

/** Coins the player starts with. */
export const START_BALANCE = 1000
/** Free coins once a day. */
export const DAILY_BONUS = 200
/** When the player is broke, they can take this much to keep playing. */
export const REFILL = 500

/** Stakes for bot games; 0 plays just for fun. */
export const STAKES = [0, 100, 500, 2500] as const

/** Stronger bots pay more for a win. */
export const LEVEL_BONUS: Record<Difficulty, number> = { easy: 1, normal: 1.5, hard: 2 }

/** Money on the table in the current bot game. */
export interface Wager {
  /** the game this belongs to (GameState.options.seed) */
  seed: number
  stake: number
  /** taken from the balance at the start: the fool pays every other player the stake */
  held: number
  /** paid on top of `held` for not being the fool */
  prize: number
}

export interface Wallet {
  balance: number
  /** highest balance ever reached */
  best: number
  /** coins won and lost in games, for the profile */
  won: number
  lost: number
  /** local date (YYYY-MM-DD) the daily bonus was last taken */
  bonusDay: string
  /** the bot game on this device */
  wager: Wager | null
  /** the online room game; kept apart so a paused bot game is not lost by playing online */
  roomWager?: Wager | null
}

export type Slot = 'wager' | 'roomWager'

export const NEW_WALLET: Wallet = { balance: START_BALANCE, best: START_BALANCE, won: 0, lost: 0, bonusDay: '', wager: null }

/**
 * What a stake means for a game with this many players. `mult` is the win bonus:
 * the bot level for bot games, 1 with real people so the table stays even.
 */
export function wagerTerms(stake: number, players: number, mult = 1) {
  return { held: stake * Math.max(1, players - 1), prize: Math.round(stake * mult) }
}

export const canAfford = (w: Wallet, stake: number, players: number) => wagerTerms(stake, players).held <= w.balance

/** The stake to actually play: the chosen one, or the largest smaller one the balance covers. */
export function affordableStake(w: Wallet, stake: number, players: number): number {
  const ok = STAKES.filter((s) => s <= stake && canAfford(w, s, players))
  return ok.length ? ok[ok.length - 1] : 0
}

/** Takes the stake for a new game. A previous game in the same slot left unfinished keeps its money lost. */
export function placeWager(w: Wallet, seed: number, stake: number, players: number, mult = 1, slot: Slot = 'wager'): Wallet {
  const old = w[slot]
  const prev = old ? { lost: w.lost + old.held } : {}
  const { held, prize } = wagerTerms(stake, players, mult)
  if (stake <= 0 || held > w.balance) return { ...w, ...prev, [slot]: null }
  return { ...w, ...prev, balance: w.balance - held, [slot]: { seed, stake, held, prize } }
}

/** Gives back the stake of a game that never got a single move. */
export function cancelWager(w: Wallet, seed: number, slot: Slot = 'wager'): Wallet {
  const g = w[slot]
  return g && g.seed === seed ? { ...w, balance: w.balance + g.held, [slot]: null } : w
}

/** What a finished game paid, shown on its result card. */
export interface PayoutInfo {
  seed: number
  delta: number
  balance: number
}

export type Outcome = 'win' | 'loss' | 'draw'

/** Pays out the wager of a finished game. `delta` is the change against the balance before the game. */
export function settle(w: Wallet, seed: number, result: Outcome, slot: Slot = 'wager'): { wallet: Wallet; delta: number } | null {
  const g = w[slot]
  if (!g || g.seed !== seed) return null
  const back = result === 'win' ? g.held + g.prize : result === 'draw' ? g.held : 0
  const balance = w.balance + back
  const delta = back - g.held
  return {
    wallet: { ...w, balance, best: Math.max(w.best, balance), won: w.won + Math.max(0, delta), lost: w.lost + Math.max(0, -delta), [slot]: null },
    delta,
  }
}

export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export const bonusReady = (w: Wallet, day = today()) => w.bonusDay !== day

export function takeBonus(w: Wallet, day = today()): Wallet {
  if (!bonusReady(w, day)) return w
  const balance = w.balance + DAILY_BONUS
  return { ...w, balance, best: Math.max(w.best, balance), bonusDay: day }
}

/** Broke: not even the smallest stake fits and nothing is riding on a game. */
export const isBroke = (w: Wallet) => !w.wager && !w.roomWager && w.balance < STAKES[1]

export function refill(w: Wallet): Wallet {
  return isBroke(w) ? { ...w, balance: Math.max(w.balance, REFILL) } : w
}

export function loadWallet(): Wallet {
  try {
    const raw = localStorage.getItem('durak.wallet')
    const w = raw ? sanitize(NEW_WALLET, JSON.parse(raw)) : NEW_WALLET
    const wager = (g: unknown): Wager | null => (g && typeof g === 'object' && [(g as Wager).seed, (g as Wager).held, (g as Wager).prize, (g as Wager).stake].every((n) => Number.isFinite(n)) ? (g as Wager) : null)
    return { ...w, balance: Math.max(0, w.balance), wager: wager(w.wager), roomWager: wager(w.roomWager) }
  } catch {
    return NEW_WALLET
  }
}

export function saveWallet(w: Wallet) {
  try {
    localStorage.setItem('durak.wallet', JSON.stringify(w))
  } catch {
    /* storage unavailable: the balance just won't persist */
  }
}

export const formatCoins = (n: number) => Math.round(n).toLocaleString('ru-RU')
