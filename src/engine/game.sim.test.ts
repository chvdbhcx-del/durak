// Long simulations: many whole games between bots. CI runs them in their own job.
import { describe, expect, it } from 'vitest'
import type { Card } from './cards'
import { chooseAction } from './bot'
import { applyAction, catchChance, cardCount, currentActor, GameState, newGame, Options } from './game'

const card = (suit: Card['suit'], rank: number): Card => ({ id: `${suit}${rank}`, suit, rank })

const opts = (o: Partial<Options> = {}): Options => ({
  players: 2,
  deckSize: 36,
  mode: 'podkidnoy',
  names: [],
  human: -1,
  seed: 1,
  ...o,
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

describe('look-ahead', () => {
  it('a hard bot always plays a legal move and finishes games with the sampling on', () => {
    for (let seed = 1; seed <= 4; seed++) {
      let g = newGame({ players: 3, deckSize: 36, mode: 'podkidnoy', names: ['A', 'B', 'C'], human: -1, seed })
      for (let i = 0; i < 800 && !g.over; i++) {
        const actor = currentActor(g)
        if (actor === null) break
        g = applyAction(g, actor, chooseAction(g, actor, 'hard'))
      }
      expect(g.over).toBe(true)
    }
  })
})

describe('bot levels', () => {

  const play = (level: 'easy' | 'normal' | 'hard', seed: number) => {
    let g = newGame({ players: 2, deckSize: 36, mode: 'podkidnoy', names: ['A', 'B'], human: -1, seed })
    for (let i = 0; i < 600 && !g.over; i++) {
      const actor = currentActor(g)
      if (actor === null) break
      g = applyAction(g, actor, chooseAction(g, actor, actor === 0 ? level : 'normal'))
    }
    return g
  }
  it('every level finishes games without illegal moves', () => {
    for (const level of ['easy', 'normal', 'hard'] as const) for (let seed = 1; seed <= 20; seed++) expect(play(level, seed).over).toBe(true)
  })
  it('a strong bot loses less often than an easy one', () => {
    const fool = (level: 'easy' | 'hard') => {
      let lost = 0
      for (let seed = 1; seed <= 40; seed++) if (play(level, seed).loser === 0) lost++
      return lost
    }
    expect(fool('hard')).toBeLessThan(fool('easy'))
  })
})

describe('bots catching bots', () => {
  it('a stronger table spots cheats more often', () => {
    expect(catchChance('easy')).toBeLessThan(catchChance('normal'))
    expect(catchChance('normal')).toBeLessThan(catchChance('hard'))
  })
  it('a cheat that gets the player out of the game is never missed by a hard table', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = newGame({ players: 2, deckSize: 36, mode: 'podkidnoy', cheat: true, level: 'hard', names: ['A', 'B'], human: 0, seed })
      s.trump = 'S'
      s.deck = []
      s.attacker = 1
      s.defender = 0
      const c = (suit: Card['suit'], rank: number): Card => ({ id: `${suit}${rank}`, suit, rank })
      s.players[0].hand = [c('D', 6)]
      s.players[1].hand = [c('H', 14), c('C', 9)]
      s.table = [{ attack: c('H', 10), defense: null }]
      const out = applyAction(s, 0, { type: 'defend', cardId: 'D6', pair: 0 })
      expect(out.caught).toContain(0)
      expect(out.players[0].hand).toHaveLength(2)
      expect(out.players[0].out).toBeFalsy()
    }
  })
  it('all-bot cheater games finish, with bluffs now and then caught by the others', () => {
    let caught = 0
    for (let seed = 1; seed <= 40; seed++) {
      let g = newGame({ players: 3, deckSize: 36, mode: 'podkidnoy', cheat: true, level: 'hard', names: ['A', 'B', 'C'], human: -1, seed })
      for (let i = 0; i < 800 && !g.over; i++) {
        const actor = currentActor(g)
        if (actor === null) break
        g = applyAction(g, actor, chooseAction(g, actor))
      }
      expect(g.over).toBe(true)
      caught += g.caught?.length ?? 0
    }
    expect(caught).toBeGreaterThan(0)
  })
})

describe('bot judgement', () => {
    /** A two-player game with chosen hands and a long deck, so it is early in the game. */
  const early = (botHand: Card[], table: GameState['table'] = [], extra: Partial<GameState> = {}): GameState => {
    const s = newGame({ players: 2, deckSize: 36, mode: 'podkidnoy', names: ['A', 'B'], human: -1, seed: 5 })
    s.trump = 'S'
    s.trumpCard = card('S', 6)
    s.players[1].hand = botHand
    s.table = table
    s.attacker = table.length ? 0 : 1
    s.defender = table.length ? 1 : 0
    return Object.assign(s, extra)
  }

  it('does not lead an ace or a trump early when a low plain card is at hand', () => {
    for (const level of ['normal', 'hard'] as const) {
      const s = early([card('H', 14), card('S', 7), card('D', 8), card('C', 13)])
      expect(chooseAction(s, 1, level)).toEqual({ type: 'attack', cardId: 'D8' })
    }
  })
  it('takes a couple of cheap cards instead of burning a trump early', () => {
    const s = early([card('S', 13), card('H', 7)], [{ attack: card('D', 8), defense: null }])
    s.players[1].hand = [card('S', 13), card('C', 7)]
    expect(chooseAction(s, 1, 'normal')).toEqual({ type: 'take' })
  })
  it('covers with a plain card when it has one, trump or not', () => {
    const s = early([card('S', 13), card('D', 10)], [{ attack: card('D', 8), defense: null }])
    expect(chooseAction(s, 1, 'normal')).toMatchObject({ type: 'defend', cardId: 'D10' })
  })
  it('does not throw in a trump early and stops after a couple of cards', () => {
    const s = early([card('S', 8), card('H', 8), card('C', 8)], [{ attack: card('D', 8), defense: card('D', 12) }], { attacker: 1, defender: 0 })
    const move = chooseAction(s, 1, 'normal')
    expect(move.type === 'attack' ? move.cardId : null).not.toBe('S8')
  })
  it('a normal bot beats an easy one over many games', () => {
    let easyLost = 0
    for (let seed = 1; seed <= 80; seed++) {
      let g = newGame({ players: 2, deckSize: 36, mode: 'podkidnoy', names: ['A', 'B'], human: -1, seed })
      for (let i = 0; i < 800 && !g.over; i++) {
        const actor = currentActor(g)
        if (actor === null) break
        g = applyAction(g, actor, chooseAction(g, actor, actor === 0 ? 'easy' : 'normal'))
      }
      if (g.loser === 0) easyLost++
    }
    expect(easyLost).toBeGreaterThan(50)
  })
})
