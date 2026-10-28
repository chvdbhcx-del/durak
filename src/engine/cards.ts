export type Suit = 'S' | 'H' | 'D' | 'C'
export const SUITS: Suit[] = ['S', 'H', 'D', 'C']

export interface Card {
  id: string
  suit: Suit
  /** 2..14, where 11 = В, 12 = Д, 13 = К, 14 = Т */
  rank: number
}

export type DeckSize = 24 | 36 | 52

export const SUIT_NAME: Record<Suit, string> = { S: 'пики', H: 'черви', D: 'бубны', C: 'трефы' }
export const isRed = (s: Suit) => s === 'H' || s === 'D'

const FACE: Record<number, string> = { 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' }
export const rankLabel = (r: number) => FACE[r] ?? String(r)

export function makeDeck(size: DeckSize): Card[] {
  const low = size === 24 ? 9 : size === 36 ? 6 : 2
  const deck: Card[] = []
  for (const suit of SUITS) for (let rank = low; rank <= 14; rank++) deck.push({ id: `${suit}${rank}`, suit, rank })
  return deck
}

/** Small seedable PRNG so games and tests can be replayed. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function beats(defense: Card, attack: Card, trump: Suit): boolean {
  if (defense.suit === attack.suit) return defense.rank > attack.rank
  return defense.suit === trump
}

/** Hand order: plain suits first, trumps last, low to high inside a suit. */
export function sortHand(hand: Card[], trump: Suit): Card[] {
  const order = SUITS.filter((s) => s !== trump).concat(trump)
  return hand.slice().sort((a, b) => order.indexOf(a.suit) - order.indexOf(b.suit) || a.rank - b.rank)
}
