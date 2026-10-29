import { beats, Card, DeckSize, makeDeck, mulberry32, shuffle, Suit } from './cards'

export type Mode = 'podkidnoy' | 'perevodnoy'

/** How sharp the bots are: how well they play, and how often they spot a cheat. */
export type Level = 'easy' | 'normal' | 'hard'

export interface Options {
  players: number
  /** seats played by people; the rest are bots. Defaults to just `human`. */
  humans?: number[]
  deckSize: DeckSize
  mode: Mode
  names: string[]
  /** "cheater" mode: people may cover with any card, never mind its rank or suit. Bots may cheat too, and people can catch them. */
  cheat?: boolean
  /** index of the human player, or -1 for an all-bot game */
  human: number
  /** bot strength, normal when missing */
  level?: Level
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
  /** cheater mode, bots only: a cover that doesn't beat, hoping nobody notices */
  | { type: 'bluff'; cardId: string; pair: number }
  /** cheater mode: a person taps a cover they think is a trick */
  | { type: 'accuse'; pair: number }

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
  /** a bot noticed a cheater: `player` was caught by bot `by` and must take the table */
  lastCaught?: { by: number; player: number } | null
  /** a person accused a bot of a trick on `pair` and was wrong */
  falseAlarm?: { by: number } | null
  /** seats caught cheating: from then on they may only cover honestly */
  caught?: number[]
}

/** Chance that a bot spots a person covering with a card that doesn't beat. */
export const CATCH_CHANCE = 0.3

/** The chance a watching bot spots a cheat grows with its strength. */
export const catchChance = (level: Level = 'normal') => (level === 'easy' ? 0.15 : level === 'hard' ? 0.5 : CATCH_CHANCE)

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
  // A cheater may throw in anything; the bots at the table may notice.
  if (canCheat(s, player)) return s.players[player].hand.slice()
  return s.players[player].hand.filter((c) => ranks.has(c.rank))
}

/** Cards of a throw-in that don't match any rank on the table: only a cheater gets to put these down. */
function offRank(s: GameState, cardIds: string[]): string[] {
  if (s.table.length === 0) return []
  const ranks = tableRanks(s)
  return cardIds.filter((id) => {
    const c = s.players.flatMap((p) => p.hand).find((h) => h.id === id)
    return !!c && !ranks.has(c.rank)
  })
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

/** Whether `player` may still cover with a card that doesn't beat: a person in cheater mode who hasn't been caught yet. */
export function canCheat(s: GameState, player: number) {
  return !!s.options.cheat && s.players[player].human && !s.caught?.includes(player)
}

export function legalActions(s: GameState, player: number): Action[] {
  if (currentActor(s) !== player) return []
  const hand = s.players[player].hand
  if (s.table.length === 0) return hand.map((c) => ({ type: 'attack', cardId: c.id }))

  if (player === s.defender && !s.taking) {
    const actions: Action[] = []
    s.table.forEach((p, i) => {
      if (p.defense) return
      const anything = canCheat(s, player)
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
    if (t.table.length > 0 && ((!tableRanks(t).has(card.rank) && !canCheat(s, player)) || !canThrowMore(t))) return false
    t.table.push({ attack: removeFromHand(t.players[player], id), defense: null })
  }
  return true
}

export function applyAction(prev: GameState, player: number, action: Action): GameState {
  const s = previewAction(prev, player, action)
  // A person's throw-in of a card that doesn't fit the table may be spotted by a bot.
  const thrown = action.type === 'throw' ? action.cardIds : action.type === 'attack' ? [action.cardId] : []
  const off = canCheat(prev, player) ? offRank(prev, thrown) : []
  if (off.length > 0) {
    const watchers = s.players.filter((p) => !p.human && !p.out && p.id !== player)
    const roll = mulberry32(((s.options.seed ?? 1) + s.deck.length * 7 + s.discard.length * 13 + s.table.length * 17 + thrown.length * 31 + 5) >>> 0)
    if (watchers.length > 0 && roll() < catchChance(s.options.level)) {
      const by = watchers[Math.floor(roll() * watchers.length)].id
      s.table = s.table.filter((pair) => {
        if (!off.includes(pair.attack.id)) return true
        s.players[player].hand.push(pair.attack)
        return false
      })
      s.caught = [...(s.caught ?? []), player]
      s.lastCaught = { by, player }
      s.passed = []
    }
  }
  // A person's cheat or a bot's bluff may be spotted by the other bots at the table.
  if ((action.type === 'defend' && canCheat(prev, player)) || action.type === 'bluff') {
    const pair = s.table[action.pair]
    const card = pair.defense
    if (card && !beats(card, pair.attack, s.trump)) {
      const watchers = s.players.filter((p) => !p.human && !p.out && p.id !== player)
      // Deterministic from the game's own state, so a replay of the same game catches the same cheats.
      const roll = mulberry32(((s.options.seed ?? 1) + s.deck.length * 7 + s.discard.length * 13 + s.table.length * 17 + card.rank * 31) >>> 0)
      if (watchers.length > 0 && roll() < catchChance(s.options.level)) {
        const by = watchers[Math.floor(roll() * watchers.length)].id
        pair.defense = null
        s.players[player].hand.push(card)
        s.taking = true
        s.passed = []
        s.lastCaught = { by, player }
        s.caught = [...(s.caught ?? []), player]
      }
    }
  }
  return settle(s)
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
    s.lastCaught = null
    return s
  }
  if (action.type === 'accuse') return accuse(prev, player, action.pair)
  if (action.type === 'bluff') return bluff(prev, player, action)
  if (!legalActions(prev, player).some((a) => sameAction(a, action))) throw new Error(`Illegal action ${JSON.stringify(action)} by ${player}`)
  const s: GameState = structuredClone(prev)
  const p = s.players[player]
  s.lastAction = { player, action }
  s.lastCaught = null
  s.falseAlarm = null

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

function bluff(prev: GameState, player: number, action: Extract<Action, { type: 'bluff' }>): GameState {
  const pl = prev.players[player]
  const open = prev.table[action.pair]
  if (!prev.options.cheat || pl.human || prev.caught?.includes(player) || currentActor(prev) !== player || player !== prev.defender || prev.taking || !open || open.defense) throw new Error('Illegal bluff')
  const s: GameState = structuredClone(prev)
  s.lastAction = { player, action }
  s.lastCaught = null
  s.falseAlarm = null
  s.table[action.pair].defense = removeFromHand(s.players[player], action.cardId)
  s.passed = []
  return s
}

/** A person taps a cover: a real trick returns it to the cheater, who takes the table and may not cheat again; a wrong guess is only noted. */
function accuse(prev: GameState, player: number, pair: number): GameState {
  const open = prev.table[pair]
  if (!prev.options.cheat || !prev.players[player].human || player === prev.defender || !open?.defense) throw new Error('Illegal accusation')
  const s: GameState = structuredClone(prev)
  s.lastCaught = null
  s.falseAlarm = null
  const card = s.table[pair].defense!
  // A cover that doesn't beat its attack is a trick, whoever laid it: a bot's bluff or a person's cheat.
  if (!beats(card, s.table[pair].attack, s.trump)) {
    s.table[pair].defense = null
    s.players[s.defender].hand.push(card)
    s.caught = [...(s.caught ?? []), s.defender]
    s.taking = true
    s.passed = []
    s.lastCaught = { by: player, player: s.defender }
  } else {
    s.falseAlarm = { by: player }
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
