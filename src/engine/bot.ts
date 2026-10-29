import { beats, Card, makeDeck, mulberry32, Suit } from './cards'
import { Action, attackOrder, GameState, legalActions } from './game'

/** Chance that a bot in cheater mode covers with a card that doesn't beat instead of taking. */
export const BLUFF_CHANCE = 0.3

export type Level = 'easy' | 'normal' | 'hard'

/** How often an easy bot botches a move: takes a cover it could play, leads at random. */
export const EASY_SLIP = 0.35

const value = (c: Card, trump: Suit) => c.rank + (c.suit === trump ? 20 : 0)

function cardById(s: GameState, player: number, id: string) {
  return s.players[player].hand.find((c) => c.id === id)!
}

/** Cheapest way to beat every open attack, or null if the bot can't cover them all. */
function planDefense(s: GameState, player: number): { cardId: string; pair: number }[] | null {
  const pool = s.players[player].hand.slice().sort((a, b) => value(a, s.trump) - value(b, s.trump))
  const open = s.table
    .map((p, pair) => ({ attack: p.attack, pair, beaten: !!p.defense }))
    .filter((p) => !p.beaten)
    .sort((a, b) => value(b.attack, s.trump) - value(a.attack, s.trump))
  const plan: { cardId: string; pair: number }[] = []
  for (const o of open) {
    const i = pool.findIndex((c) => beats(c, o.attack, s.trump))
    if (i < 0) return null
    plan.push({ cardId: pool[i].id, pair: o.pair })
    pool.splice(i, 1)
  }
  return plan
}

/** Cards this bot cannot place: everything not in its hand, the discard, on the table or the open trump. */
function unseenCards(s: GameState, player: number): Card[] {
  const known = new Set<string>([s.trumpCard.id])
  for (const c of s.discard) known.add(c.id)
  for (const c of s.players[player].hand) known.add(c.id)
  for (const p of s.table) {
    known.add(p.attack.id)
    if (p.defense) known.add(p.defense.id)
  }
  return makeDeck(s.options.deckSize).filter((c) => !known.has(c.id))
}

/** How many unseen cards would cover `card`, as a share of all unseen cards. Lower is a safer lead. */
function coverRisk(card: Card, unseen: Card[], trump: Suit): number {
  if (unseen.length === 0) return 0
  return unseen.filter((u) => beats(u, card, trump)).length / unseen.length
}

/** Deterministic dice for a move, so a replayed game plays the same way. */
function dice(s: GameState, player: number, salt: number) {
  return mulberry32(((s.options.seed ?? 1) + s.deck.length * 13 + s.discard.length * 7 + s.table.length * 17 + s.players[player].hand.length * 29 + salt) >>> 0)()
}

export function chooseAction(s: GameState, player: number, level: Level = 'normal'): Action {
  const legal = legalActions(s, player)
  if (legal.length === 0) throw new Error('Bot has no legal action')
  if (level === 'easy' && dice(s, player, 3) < EASY_SLIP) {
    const slip = easySlip(s, player, legal)
    if (slip) return slip
  }
  const trump = s.trump
  const endgame = s.deck.length === 0
  const byValue = (a: Action, b: Action) =>
    value(cardById(s, player, (a as { cardId: string }).cardId), trump) - value(cardById(s, player, (b as { cardId: string }).cardId), trump)

  const hard = level === 'hard'
  const unseen = hard ? unseenCards(s, player) : []

  // Lead: lowest card, preferring a rank we hold several of. A strong bot picks the card
  // the unseen cards are least likely to cover, trading a little value for safety.
  if (s.table.length === 0) {
    const hand = s.players[player].hand
    if (hard) {
      const scored = hand.map((c) => ({ c, score: value(c, trump) + coverRisk(c, unseen, trump) * 40 - hand.filter((o) => o.rank === c.rank).length * 3 }))
      scored.sort((a, b) => a.score - b.score)
      return { type: 'attack', cardId: scored[0].c.id }
    }
    const counts = new Map<number, number>()
    for (const c of hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1)
    const best = hand
      .slice()
      .sort((a, b) => value(a, trump) - (counts.get(a.rank)! - 1) * 3 - (value(b, trump) - (counts.get(b.rank)! - 1) * 3))[0]
    return { type: 'attack', cardId: best.id }
  }

  if (player === s.defender && !s.taking) {
    const transfers = legal.filter((a) => a.type === 'transfer').sort(byValue)
    if (transfers.length) {
      const c = cardById(s, player, (transfers[0] as { cardId: string }).cardId)
      if (c.suit !== trump || endgame) return transfers[0]
    }
    const plan = planDefense(s, player)
    if (!plan) return bluffOrTake(s, player)
    // A strong bot keeps its trumps while the deck lasts: taking a couple of cheap cards costs less.
    if (hard && !endgame && s.deck.length > 4 && plan.some((st) => cardById(s, player, st.cardId).suit === trump) && s.table.every((p) => p.attack.rank <= 10)) return { type: 'take' }
    // Don't burn a high trump on a cheap card early in the game.
    const spend = plan.reduce((n, step) => n + value(cardById(s, player, step.cardId), trump), 0)
    const cheapTable = s.table.every((p) => p.attack.suit !== trump && p.attack.rank <= 9)
    if (!endgame && s.deck.length > 8 && cheapTable && spend > 30 * plan.length && s.table.length === 1) return { type: 'take' }
    return { type: 'defend', ...plan[0] }
  }

  // Throwing in. A strong bot piles on when the defender has to take anyway, and holds back
  // cards the defender could well beat otherwise.
  const throws = legal.filter((a) => a.type === 'attack').sort(byValue)
  for (const t of throws) {
    const c = cardById(s, player, (t as { cardId: string }).cardId)
    const cheap = c.suit !== trump && c.rank <= (s.taking ? (hard ? 14 : 12) : 11)
    if (hard && !s.taking && !endgame && coverRisk(c, unseen, trump) > 0.55) continue
    if (cheap || endgame) return t
  }
  return { type: 'pass' }
}

/** An easy bot's blunder: take when it could cover, or lead a random card. */
function easySlip(s: GameState, player: number, legal: Action[]): Action | null {
  if (s.table.length === 0) {
    const leads = legal.filter((a) => a.type === 'attack')
    return leads.length ? leads[Math.floor(dice(s, player, 5) * leads.length)] : null
  }
  if (player === s.defender && !s.taking && legal.some((a) => a.type === 'take')) return { type: 'take' }
  return null
}

/** Deterministic from the game state, so a replayed game bluffs the same way. */
function bluffOrTake(s: GameState, player: number): Action {
  const watched = s.options.cheat && !s.caught?.includes(player) && attackOrder(s).some((id) => s.players[id].human && !s.players[id].out)
  const pair = s.table.findIndex((p) => !p.defense)
  if (!watched || pair < 0) return { type: 'take' }
  const roll = mulberry32(((s.options.seed ?? 1) + s.deck.length * 11 + s.discard.length * 5 + s.table.length * 19 + s.players[player].hand.length * 23) >>> 0)
  if (roll() >= BLUFF_CHANCE) return { type: 'take' }
  const hand = s.players[player].hand.slice().sort((a, b) => value(a, s.trump) - value(b, s.trump))
  return { type: 'bluff', cardId: hand[0].id, pair }
}
