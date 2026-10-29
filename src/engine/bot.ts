import { beats, Card, makeDeck, mulberry32, Suit } from './cards'
import { Action, attackOrder, GameState, legalActions, type Level } from './game'

/** Chance that a bot in cheater mode covers with a card that doesn't beat instead of taking. */
export const BLUFF_CHANCE = 0.3

/** Careless bots bluff more, careful ones less: the stronger a table, the likelier a trick is spotted. */
const bluffChance = (level: Level) => (level === 'easy' ? 0.4 : level === 'hard' ? 0.15 : BLUFF_CHANCE)

export type { Level }

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

export function chooseAction(s: GameState, player: number, level: Level = s.options.level ?? 'normal'): Action {
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
  if (s.table.length === 0) return { type: 'attack', cardId: chooseLead(s, player, level, unseen).id }

  if (player === s.defender && !s.taking) {
    const transfers = legal.filter((a) => a.type === 'transfer').sort(byValue)
    if (transfers.length) {
      const c = cardById(s, player, (transfers[0] as { cardId: string }).cardId)
      if (c.suit !== trump || endgame) return transfers[0]
    }
    const plan = planDefense(s, player)
    if (!plan) return bluffOrTake(s, player, level)
    if (level === 'easy') {
      // A careless bot only avoids the most obvious waste.
      const spend = plan.reduce((n, step) => n + value(cardById(s, player, step.cardId), trump), 0)
      const cheapTable = s.table.every((p) => p.attack.suit !== trump && p.attack.rank <= 9)
      if (!endgame && s.deck.length > 8 && cheapTable && spend > 30 * plan.length && s.table.length === 1) return { type: 'take' }
      return { type: 'defend', ...plan[0] }
    }
    return worthDefending(s, player, plan) ? { type: 'defend', ...plan[0] } : { type: 'take' }
  }

  // Throwing in.
  const throws = legal.filter((a) => a.type === 'attack').sort(byValue)
  for (const t of throws) {
    const c = cardById(s, player, (t as { cardId: string }).cardId)
    if (level === 'easy') {
      // A careless bot dumps whatever is cheap, as long as it can.
      if ((c.suit !== trump && c.rank <= (s.taking ? 12 : 11)) || endgame) return t
      continue
    }
    if (worthThrowing(s, player, c, level, unseen)) return t
  }
  return { type: 'pass' }
}

type Phase = 'early' | 'mid' | 'late'
const phaseOf = (s: GameState): Phase => (s.deck.length > 12 ? 'early' : s.deck.length > 0 ? 'mid' : 'late')

/**
 * Whether to spend the cards in `plan` on beating the attack, or to pick the cards up instead.
 * Like a person would: early on, a trump or a court card is worth more than the few cheap cards on
 * the table, so take those; later, or with a big table, defend, and never let the hand grow too big.
 */
function worthDefending(s: GameState, player: number, plan: { cardId: string; pair: number }[]): boolean {
  const phase = phaseOf(s)
  if (phase === 'late') return true
  const hand = s.players[player].hand
  const spent = plan.map((st) => cardById(s, player, st.cardId))
  const onTable = s.table.reduce((n, p) => n + 1 + (p.defense ? 1 : 0), 0)
  // How many cards a bot is willing to pick up to keep its good cards.
  const tolerance = phase === 'early' ? 3 : 2
  // Too many cards in hand already: better to get rid of some.
  if (hand.length + onTable > 10) return true
  const trumpOnPlain = plan.some((st) => cardById(s, player, st.cardId).suit === s.trump && s.table[st.pair].attack.suit !== s.trump)
  const highTrump = spent.some((c) => c.suit === s.trump && c.rank >= 12)
  const bigSpend = spent.reduce((n, c) => n + value(c, s.trump), 0) > 30 * plan.length
  const cheapAttack = s.table.every((p) => p.attack.rank <= 10)
  if (onTable <= tolerance && trumpOnPlain && cheapAttack) return false
  if (onTable <= tolerance - 1 && (highTrump || bigSpend) && cheapAttack) return false
  return true
}

/**
 * Whether a card is worth throwing in. Throwing in forces the defender to cover (or take) more,
 * but it also spends cards; a person keeps trumps and court cards early, throws a couple of cheap
 * ones, and goes all in only in the endgame or when the defender is picking up anyway.
 */
function worthThrowing(s: GameState, player: number, c: Card, level: Level, unseen: Card[]): boolean {
  const phase = phaseOf(s)
  const taking = s.taking
  const hand = s.players[player].hand
  if (c.suit === s.trump) return phase === 'late' && (hand.length <= 2 || taking)
  // Don't pile everything on: a few cards, more when the defender must take them anyway.
  const aim = taking ? 3 : 2
  if (phase !== 'late' && s.table.length >= aim) return false
  const cap = phase === 'early' ? (taking ? 10 : 8) : phase === 'mid' ? (taking ? 12 : 9) : 14
  if (c.rank > cap) return false
  if (level === 'hard' && !taking && phase !== 'late' && coverRisk(c, unseen, s.trump) > 0.55) return false
  return true
}

/**
 * The opening card of a round. Early on a person leads a low plain card (a pair if there is one) and
 * keeps aces, kings and trumps for when they matter; in the endgame a sharp bot leads the card the
 * unseen cards are least able to cover.
 */
function chooseLead(s: GameState, player: number, level: Level, unseen: Card[]): Card {
  const hand = s.players[player].hand
  const trump = s.trump
  const count = (c: Card) => hand.filter((o) => o.rank === c.rank).length
  if (level === 'hard' && phaseOf(s) === 'late') {
    return hand.slice().sort((a, b) => value(a, trump) + coverRisk(a, unseen, trump) * 30 - count(a) * 3 - (value(b, trump) + coverRisk(b, unseen, trump) * 30 - count(b) * 3))[0]
  }
  const early = phaseOf(s) !== 'late'
  const tier = (c: Card) => (c.suit === trump ? 2 : early && c.rank >= 13 ? 1 : 0)
  return hand.slice().sort((a, b) => tier(a) - tier(b) || value(a, trump) - (count(a) - 1) * 3 - (value(b, trump) - (count(b) - 1) * 3))[0]
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
function bluffOrTake(s: GameState, player: number, level: Level): Action {
  // Someone has to be at the table to fool: a person, or another bot that may or may not spot it.
  const watched = s.options.cheat && !s.caught?.includes(player) && attackOrder(s).some((id) => id !== player && !s.players[id].out)
  const pair = s.table.findIndex((p) => !p.defense)
  if (!watched || pair < 0) return { type: 'take' }
  const roll = mulberry32(((s.options.seed ?? 1) + s.deck.length * 11 + s.discard.length * 5 + s.table.length * 19 + s.players[player].hand.length * 23) >>> 0)
  if (roll() >= bluffChance(level)) return { type: 'take' }
  const hand = s.players[player].hand.slice().sort((a, b) => value(a, s.trump) - value(b, s.trump))
  return { type: 'bluff', cardId: hand[0].id, pair }
}
