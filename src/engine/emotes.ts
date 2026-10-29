import type { GameState } from './game'

/** The quick reactions a player can send. */
export const EMOTES = ['👍', '😂', '😎', '😡', '😮', '🤔', '😢', '🔥']

export interface Reaction {
  seat: number
  emoji: string
}

export interface Emote extends Reaction {
  /** unique per emote, so the same one sent twice shows twice */
  key: number
}

const pick = <T>(rng: () => number, items: T[]) => items[Math.floor(rng() * items.length)]
const botSeats = (s: GameState) => s.players.filter((p) => !p.human).map((p) => p.id)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Changes whenever something worth reacting to may have happened. */
export function fingerprint(s: GameState) {
  return JSON.stringify([s.lastAction, s.lastRound, s.lastCaught, s.falseAlarm, s.discard.length, s.deck.length, s.over])
}

/**
 * How a bot at the table might react to what just happened between two states, or null.
 * Bots gloat when somebody takes cards or is caught cheating, sulk when it happens to them,
 * and react to the end of the game, to going out, and to a huge attack.
 */
export function botReaction(prev: GameState, next: GameState, rng: () => number): Reaction | null {
  const bots = botSeats(next)
  if (bots.length === 0) return null
  const isBot = (id: number | null | undefined): id is number => id !== null && id !== undefined && bots.includes(id)
  const other = (not: number) => {
    const rest = bots.filter((id) => id !== not)
    return rest.length ? pick(rng, rest) : null
  }

  if (next.over && !prev.over) {
    if (next.loser === null) return { seat: pick(rng, bots), emoji: '😮' }
    if (isBot(next.loser) && rng() < 0.9) return { seat: next.loser, emoji: pick(rng, ['😡', '😢']) }
    const winner = other(next.loser)
    return winner !== null && rng() < 0.7 ? { seat: winner, emoji: pick(rng, ['😎', '🔥']) } : null
  }

  if (next.lastCaught && !same(next.lastCaught, prev.lastCaught)) {
    if (isBot(next.lastCaught.by)) return { seat: next.lastCaught.by, emoji: pick(rng, ['😎', '🔥']) }
    if (isBot(next.lastCaught.player)) return { seat: next.lastCaught.player, emoji: pick(rng, ['😡', '😢']) }
    return null
  }

  if (next.falseAlarm && !same(next.falseAlarm, prev.falseAlarm)) return isBot(next.defender) && rng() < 0.8 ? { seat: next.defender, emoji: '😂' } : null

  const wentOut = next.players.find((p) => p.out && !prev.players[p.id].out)
  if (wentOut && isBot(wentOut.id) && rng() < 0.7) return { seat: wentOut.id, emoji: pick(rng, ['😎', '🔥']) }

  if (next.lastRound && !same(next.lastRound, prev.lastRound)) {
    const d = next.lastRound.defender
    if (next.lastRound.end === 'taken') {
      if (isBot(d)) return rng() < 0.35 ? { seat: d, emoji: pick(rng, ['😢', '😡', '🤔']) } : null
      const watcher = pick(rng, bots)
      return rng() < (next.players[d]?.human ? 0.3 : 0.15) ? { seat: watcher, emoji: pick(rng, ['😂', '😎']) } : null
    }
    if (isBot(d)) return rng() < 0.3 ? { seat: d, emoji: pick(rng, ['😎', '👍']) } : null
    const watcher = other(d)
    return watcher !== null && rng() < 0.12 ? { seat: watcher, emoji: '😮' } : null
  }

  if (next.table.length >= 5 && prev.table.length < 5 && isBot(next.defender) && rng() < 0.5) return { seat: next.defender, emoji: '😮' }
  return null
}

const REPLIES: Record<string, string[]> = {
  '👍': ['👍', '😎'],
  '😂': ['😂', '😎'],
  '😎': ['🤔', '😂'],
  '😡': ['😮', '🤔'],
  '😮': ['😎', '🤔'],
  '🤔': ['🤔', '😂'],
  '😢': ['👍', '🤔'],
  '🔥': ['😮', '😎'],
}

/** A bot answering a person's emote, now and then. */
export function botReply(emoji: string, s: GameState, rng: () => number): Reaction | null {
  const bots = botSeats(s)
  if (bots.length === 0 || rng() > 0.5) return null
  return { seat: pick(rng, bots), emoji: pick(rng, REPLIES[emoji] ?? ['👍']) }
}
