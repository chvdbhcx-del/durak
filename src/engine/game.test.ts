import { describe, expect, it } from 'vitest'
import { beats, Card } from './cards'
import { chooseAction } from './bot'
import { applyAction, cardCount, currentActor, GameState, legalActions, newGame, Options } from './game'

const opts = (o: Partial<Options> = {}): Options => ({
  players: 2,
  deckSize: 36,
  mode: 'podkidnoy',
  names: [],
  human: -1,
  seed: 1,
  ...o,
})

const card = (suit: Card['suit'], rank: number): Card => ({ id: `${suit}${rank}`, suit, rank })

/** Hand-built two-player position for targeted rule checks. */
function position(hands: Card[][], o: Partial<Options> = {}): GameState {
  const s = newGame(opts({ players: hands.length, ...o }))
  s.players.forEach((p, i) => (p.hand = hands[i]))
  s.deck = [card('C', 6)]
  s.trump = 'C'
  s.trumpCard = s.deck[0]
  s.attacker = 0
  s.defender = 1
  s.limit = Math.min(6, hands[1].length)
  return s
}

describe('beats', () => {
  it('compares within a suit and lets trumps cover other suits', () => {
    expect(beats(card('H', 10), card('H', 9), 'S')).toBe(true)
    expect(beats(card('H', 8), card('H', 9), 'S')).toBe(false)
    expect(beats(card('S', 6), card('H', 14), 'S')).toBe(true)
    expect(beats(card('D', 14), card('H', 6), 'S')).toBe(false)
  })
})

describe('setup', () => {
  it('deals six cards each and leads with the lowest trump', () => {
    const s = newGame(opts({ players: 4 }))
    expect(s.players.every((p) => p.hand.length === 6)).toBe(true)
    expect(s.deck.length).toBe(12)
    expect(s.deck[0]).toEqual(s.trumpCard)
    const lowest = Math.min(...s.players.flatMap((p) => p.hand.filter((c) => c.suit === s.trump).map((c) => c.rank)))
    expect(s.players[s.attacker].hand.some((c) => c.suit === s.trump && c.rank === lowest)).toBe(true)
  })
})

describe('rounds', () => {
  it('discards a beaten round and passes the lead to the defender', () => {
    let s = position([[card('H', 7), card('D', 9)], [card('H', 10), card('S', 6)]])
    s = applyAction(s, 0, { type: 'attack', cardId: 'H7' })
    // The attacker has nothing to throw in, so the round closes on its own.
    s = applyAction(s, 1, { type: 'defend', cardId: 'H10', pair: 0 })
    expect(s.discard.map((c) => c.id).sort()).toEqual(['H10', 'H7'])
    expect(s.attacker).toBe(1)
  })

  it('lets attackers throw in while the defender takes', () => {
    let s = position([[card('H', 7), card('D', 7), card('S', 12)], [card('S', 6), card('S', 8), card('D', 10)]])
    s = applyAction(s, 0, { type: 'attack', cardId: 'H7' })
    s = applyAction(s, 1, { type: 'take' })
    expect(legalActions(s, 0)).toContainEqual({ type: 'attack', cardId: 'D7' })
    s = applyAction(s, 0, { type: 'attack', cardId: 'D7' })
    expect(s.players[1].hand.map((c) => c.id)).toEqual(expect.arrayContaining(['H7', 'D7']))
    expect(s.attacker).toBe(0)
  })

  it('caps throw-ins at the defender hand size', () => {
    let s = position([[card('H', 7), card('D', 7), card('S', 7)], [card('C', 14)]])
    s = applyAction(s, 0, { type: 'attack', cardId: 'H7' })
    s = applyAction(s, 1, { type: 'take' })
    expect(currentActor(s)).toBe(0)
    expect(s.table.length).toBe(0) // round closed: nothing more could be thrown
    expect(s.players[1].hand.length).toBe(2)
  })

  it('only allows transfers in perevodnoy with a matching rank', () => {
    const hands = [[card('H', 7)], [card('D', 7), card('H', 9)], [card('S', 9), card('S', 10)]]
    const pod = applyAction(position(hands), 0, { type: 'attack', cardId: 'H7' })
    expect(legalActions(pod, 1).some((a) => a.type === 'transfer')).toBe(false)

    let s = applyAction(position(hands, { mode: 'perevodnoy' }), 0, { type: 'attack', cardId: 'H7' })
    expect(legalActions(s, 1)).toContainEqual({ type: 'transfer', cardId: 'D7' })
    s = applyAction(s, 1, { type: 'transfer', cardId: 'D7' })
    expect(s.attacker).toBe(1)
    expect(s.defender).toBe(2)
    expect(s.table.length).toBe(2)
  })
})

describe('full games', () => {
  for (const mode of ['podkidnoy', 'perevodnoy'] as const)
    for (const deckSize of [24, 36, 52] as const)
      it(`bots finish ${mode} games with a ${deckSize}-card deck`, () => {
        const maxP = Math.floor(deckSize / 6)
        for (let seed = 1; seed <= 60; seed++) {
          const players = 2 + (seed % (Math.min(6, maxP) - 1))
          let s = newGame(opts({ players, deckSize, mode, seed }))
          let steps = 0
          while (!s.over) {
            const actor = currentActor(s)!
            s = applyAction(s, actor, chooseAction(s, actor))
            expect(cardCount(s)).toBe(deckSize)
            if (++steps > 2000) throw new Error('game did not finish')
          }
        }
      })
})
