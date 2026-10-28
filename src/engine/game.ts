import { beats, Card, DeckSize, makeDeck, mulberry32, shuffle, Suit } from './cards'

export type Mode = 'podkidnoy' | 'perevodnoy'

export interface Options {
  players: number
  /** seats played by people; the rest are bots. Defaults to just `human`. */
  humans?: number[]
  deckSize: DeckSize
  mode: Mode
  names: string[]
  /** "cheater" mode: people may cover with any card, never mind its rank or suit. Bots stay honest. */
  cheat?: boolean
  /** index of the human player, or -1 for an all-bot game */
  human: number
  seed?: number
}

export interface Player {
  id: number
  name: string
  hand: Card[]
  human: boolean
  out: boolean
}

export interface Pair {
  attack: Card
  defense: Card | null
}

export type Action =
  | { type: 'attack'; cardId: string }
  /** several cards at once: an opening lead of one rank, or a batch of throw-ins */
  | { type: 'throw'; cardIds: string[] }
  | { type: 'defend'; cardId: string; pair: number }
  | { type: 'transfer'; cardId: string }
  | { type: 'take' }
  | { type: 'pass' }

export type RoundEnd = 'beaten' | 'taken'

export interface GameState {
  options: Options
  players: Player[]
  /** deck[0] is the face-up trump at the bottom; cards are drawn from the end */
  deck: Card[]
  trump: Suit
  trumpCard: Card
  table: Pair[]
  discard: Card[]
  attacker: number
  defender: number
  taking: boolean
  /** attackers who are done throwing in since the table last changed */
  passed: number[]
  /** max attack cards this round: min(6, defender hand at round start) */
  limit: number
  over: boolean
  /** null with over = true means a draw */
  loser: number | null
  lastRound: { end: RoundEnd; defender: number } | null
  lastAction: { player: number; action: Action } | null
}

export const HAND_SIZE = 6

export function maxPlayers(deckSize: DeckSize) {
  return Math.min(6, Math.floor(deckSize / HAND_SIZE))
}

export function newGame(options: Options): GameState {
  const rng = mulberry32(options.seed ?? Date.now())
  // Ids are opaque per game so an online view can hide a card's face without hiding which card moved.
  const deck = shuffle(makeDeck(options.deckSize), rng).map((c, i) => ({ ...c, id: `${Math.floor(rng() * 1e9).toString(36)}${i}` }))
  const trumpCard = deck[0]
  const players: Player[] = Array.from({ length: options.players }, (_, id) => ({
    id,
    name: options.names[id] ?? `Игрок ${id + 1}`,
    hand: [],
    human: options.humans ? options.humans.includes(id) : id === options.human,
    out: false,
  }))
  for (let round = 0; round < HAND_SIZE; round++) for (const p of players) p.hand.push(deck.pop()!)

  const trump = trumpCard.suit
  // The lowest trump leads; with no trumps dealt, pick at random.
  let attacker = Math.floor(rng() * players.length)
  let lowest = Infinity
  for (const p of players)
    for (const c of p.hand)
      if (c.suit === trump && c.rank < lowest) {
        lowest = c.rank
        attacker = p.id
      }
  const defender = (attacker + 1) % players.length

  return {
    options,
    players,
    deck,
    trump,
    trumpCard,
    table: [],
    discard: [],
    attacker,
    defender,
    taking: false,
    passed: [],
    limit: Math.min(HAND_SIZE, players[defender].hand.length),
    over: false,
    loser: null,
    lastRound: null,
    lastAction: null,
  }
}

function nextActive(s: GameState, from: number): number {
  const n = s.players.length
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n
    if (!s.players[i].out) return i
  }
  return from
}

/** Main attacker first, then the rest clockwise, never the defender. */
export function attackOrder(s: GameState): number[] {
  const n = s.players.length
  const order: number[] = []
  for (let k = 0; k < n; k++) {
    const i = (s.attacker + k) % n
    if (i !== s.defender && !s.players[i].out) order.push(i)
  }
  return order
}

const unbeaten = (s: GameState) => s.table.filter((p) => !p.defense).length
const tableRanks = (s: GameState) => new Set(s.table.flatMap((p) => (p.defense ? [p.attack.rank, p.defense.rank] : [p.attack.rank])))

/** Whose decision the game is waiting for, or null when it is over. */
export function currentActor(s: GameState): number | null {
  if (s.over) return null
  if (s.table.length === 0) return s.attacker
  if (!s.taking && unbeaten(s) > 0) return s.defender
  return attackOrder(s).find((p) => !s.passed.includes(p)) ?? null
}

function canThrowMore(s: GameState) {
  return s.table.length < s.limit && unbeaten(s) < s.players[s.defender].hand.length
}

function throwInCards(s: GameState, player: number): Card[] {
  if (!canThrowMore(s)) return []
  const ranks = tableRanks(s)
  return s.players[player].hand.filter((c) => ranks.has(c.rank))
}

function transferTarget(s: GameState) {
  return nextActive(s, s.defender)
}

function canTransfer(s: GameState): boolean {
  if (s.options.mode !== 'perevodnoy' || s.taking || s.table.length === 0) return false
  if (s.table.some((p) => p.defense)) return false
  const rank = s.table[0].attack.rank
  if (s.table.some((p) => p.attack.rank !== rank)) return false
  const target = transferTarget(s)
  return target !== s.defender && s.players[target].hand.length >= s.table.length + 1 && s.table.length + 1 <= HAND_SIZE
}

export function legalActions(s: GameState, player: number): Action[] {
  if (currentActor(s) !== player) return []
  const hand = s.players[player].hand
  if (s.table.length === 0) return hand.map((c) => ({ type: 'attack', cardId: c.id }))

  if (player === s.defender && !s.taking) {
    const actions: Action[] = []
    s.table.forEach((p, i) => {
      if (p.defense) return
      const anything = !!s.options.cheat && s.players[player].human
      for (const c of hand) if (anything || beats(c, p.attack, s.trump)) actions.push({ type: 'defend', cardId: c.id, pair: i })
    })
    if (canTransfer(s)) {
      const rank = s.table[0].attack.rank
      for (const c of hand) if (c.rank === rank) actions.push({ type: 'transfer', cardId: c.id })
    }
    actions.push({ type: 'take' })
    return actions
  }

  return [...throwInCards(s, player).map((c): Action => ({ type: 'attack', cardId: c.id })), { type: 'pass' }]
}

function removeFromHand(p: Player, cardId: string): Card {
  const i = p.hand.findIndex((c) => c.id === cardId)
  if (i < 0) throw new Error(`Card ${cardId} is not in ${p.name}'s hand`)
  return p.hand.splice(i, 1)[0]
}

function sameAction(a: Action, b: Action) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Whether `player` may put all of `cardIds` down in one go, checked card by card. */
export function canThrow(s: GameState, player: number, cardIds: string[]): boolean {
  if (cardIds.length === 0 || new Set(cardIds).size !== cardIds.length) return false
  if (!legalActions(s, player).some((a) => a.type === 'attack')) return false
  const t: GameState = structuredClone(s)
  const hand = t.players[player].hand
  for (const id of cardIds) {
    const card = hand.find((c) => c.id === id)
    if (!card) return false
    if (t.table.length > 0 && (!tableRanks(t).has(card.rank) || !canThrowMore(t))) return false
    t.table.push({ attack: removeFromHand(t.players[player], id), defense: null })
  }
  return true
}

export function applyAction(prev: GameState, player: number, action: Action): GameState {
  return settle(previewAction(prev, player, action))
}

/**
 * The move on its own, without closing the round afterwards: what the table looks like
 * while a player is still lining up cards before confirming them.
 */
export function previewAction(prev: GameState, player: number, action: Action): GameState {
  if (action.type === 'throw') {
    if (!canThrow(prev, player, action.cardIds)) throw new Error(`Illegal throw ${JSON.stringify(action.cardIds)} by ${player}`)
    const s: GameState = structuredClone(prev)
    for (const id of action.cardIds) s.table.push({ attack: removeFromHand(s.players[player], id), defense: null })
    s.passed = []
    s.lastAction = { player, action }
    return s
  }
  if (!legalActions(prev, player).some((a) => sameAction(a, action))) throw new Error(`Illegal action ${JSON.stringify(action)} by ${player}`)
  const s: GameState = structuredClone(prev)
  const p = s.players[player]
  s.lastAction = { player, action }

  switch (action.type) {
    case 'attack':
      s.table.push({ attack: removeFromHand(p, action.cardId), defense: null })
      s.passed = []
      break
    case 'defend':
      s.table[action.pair].defense = removeFromHand(p, action.cardId)
      s.passed = []
      break
    case 'transfer': {
      s.table.push({ attack: removeFromHand(p, action.cardId), defense: null })
      s.attacker = s.defender
      s.defender = transferTarget(s)
      s.limit = Math.min(HAND_SIZE, s.players[s.defender].hand.length)
      s.passed = []
      break
    }
    case 'take':
      s.taking = true
      s.passed = []
      break
    case 'pass':
      s.passed.push(player)
      break
  }
  return s
}

/** Skip attackers with nothing to throw and close the round once everyone is done. */
function settle(s: GameState): GameState {
  if (s.table.length === 0 || (!s.taking && unbeaten(s) > 0)) return s
  for (const id of attackOrder(s)) {
    if (s.passed.includes(id)) continue
    // People always confirm with a button, even when they have nothing to add.
    if (s.players[id].human || throwInCards(s, id).length > 0) return s
    s.passed.push(id)
  }
  return endRound(s)
}

function endRound(s: GameState): GameState {
  const cards = s.table.flatMap((p) => (p.defense ? [p.attack, p.defense] : [p.attack]))
  const took = s.taking
  if (took) s.players[s.defender].hand.push(...cards)
  else s.discard.push(...cards)
  s.lastRound = { end: took ? 'taken' : 'beaten', defender: s.defender }
  s.table = []

  const drawOrder = [...attackOrder(s), s.defender]
  for (const id of drawOrder) {
    const hand = s.players[id].hand
    while (hand.length < HAND_SIZE && s.deck.length > 0) hand.push(s.deck.pop()!)
  }

  if (s.deck.length === 0) for (const p of s.players) if (p.hand.length === 0) p.out = true
  const active = s.players.filter((p) => !p.out)
  if (active.length <= 1) {
    s.over = true
    s.loser = active[0]?.id ?? null
    s.taking = false
    s.passed = []
    return s
  }

  const oldDefender = s.defender
  s.attacker = took || s.players[oldDefender].out ? nextActive(s, oldDefender) : oldDefender
  s.defender = nextActive(s, s.attacker)
  s.limit = Math.min(HAND_SIZE, s.players[s.defender].hand.length)
  s.taking = false
  s.passed = []
  return s
}

export function cardCount(s: GameState) {
  return s.deck.length + s.discard.length + s.table.reduce((n, p) => n + (p.defense ? 2 : 1), 0) + s.players.reduce((n, p) => n + p.hand.length, 0)
}

/** What one seat may see: other hands and the closed deck lose their faces, ids stay. */
export function viewFor(s: GameState, seat: number): GameState {
  const hide = (c: Card): Card => ({ id: c.id, suit: 'S', rank: 0 })
  return {
    ...s,
    players: s.players.map((p) => (p.id === seat ? p : { ...p, hand: p.hand.map(hide) })),
    deck: s.deck.map((c, i) => (i === 0 ? c : hide(c))),
    discard: s.discard.map(hide),
  }
}
