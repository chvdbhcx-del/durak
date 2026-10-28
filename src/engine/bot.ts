import { beats, Card, Suit } from './cards'
import { Action, GameState, legalActions } from './game'

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

export function chooseAction(s: GameState, player: number): Action {
  const legal = legalActions(s, player)
  if (legal.length === 0) throw new Error('Bot has no legal action')
  const trump = s.trump
  const endgame = s.deck.length === 0
  const byValue = (a: Action, b: Action) =>
    value(cardById(s, player, (a as { cardId: string }).cardId), trump) - value(cardById(s, player, (b as { cardId: string }).cardId), trump)

  // Lead: lowest card, preferring a rank we hold several of.
  if (s.table.length === 0) {
    const hand = s.players[player].hand
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
    if (!plan) return { type: 'take' }
    // Don't burn a high trump on a cheap card early in the game.
    const spend = plan.reduce((n, step) => n + value(cardById(s, player, step.cardId), trump), 0)
    const cheapTable = s.table.every((p) => p.attack.suit !== trump && p.attack.rank <= 9)
    if (!endgame && s.deck.length > 8 && cheapTable && spend > 30 * plan.length && s.table.length === 1) return { type: 'take' }
    return { type: 'defend', ...plan[0] }
  }

  // Throwing in.
  const throws = legal.filter((a) => a.type === 'attack').sort(byValue)
  for (const t of throws) {
    const c = cardById(s, player, (t as { cardId: string }).cardId)
    const cheap = c.suit !== trump && c.rank <= (s.taking ? 12 : 11)
    if (cheap || endgame) return t
  }
  return { type: 'pass' }
}
