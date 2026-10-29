import { describe, expect, it } from 'vitest'
import { beats, Card } from './cards'
import { chooseAction } from './bot'
import { botReaction, botReply } from './emotes'
import { applyAction, canCheat, catchChance, canThrow, cardCount, currentActor, GameState, legalActions, newGame, Options } from './game'

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

describe('throwing several cards', () => {
  it('leads with a pair of one rank and refuses mixed ranks', () => {
    const s = position([[card('H', 7), card('D', 7), card('S', 12)], [card('S', 6), card('S', 8), card('D', 10)]])
    expect(canThrow(s, 0, ['H7', 'D7'])).toBe(true)
    expect(canThrow(s, 0, ['H7', 'S12'])).toBe(false)
    const next = applyAction(s, 0, { type: 'throw', cardIds: ['H7', 'D7'] })
    expect(next.table.length).toBe(2)
    expect(currentActor(next)).toBe(1)
  })

  it('never throws more than the defender can cover', () => {
    const s = position([[card('H', 7), card('D', 7), card('S', 7)], [card('S', 6), card('S', 8)]])
    expect(canThrow(s, 0, ['H7', 'D7'])).toBe(true)
    expect(canThrow(s, 0, ['H7', 'D7', 'S7'])).toBe(false)
  })

  it('waits for a person to say "bito" even with nothing to throw', () => {
    let s = position([[card('H', 7), card('D', 9)], [card('H', 10), card('S', 6)]], { human: 0 })
    s = applyAction(s, 0, { type: 'attack', cardId: 'H7' })
    s = applyAction(s, 1, { type: 'defend', cardId: 'H10', pair: 0 })
    expect(currentActor(s)).toBe(0)
    expect(legalActions(s, 0)).toEqual([{ type: 'pass' }])
    s = applyAction(s, 0, { type: 'pass' })
    expect(s.discard.length).toBe(2)
  })
})

describe('cheater mode', () => {
  it('lets a person cover with a card that does not beat, but never a bot', () => {
    const hands = [[card('H', 7), card('D', 9)], [card('D', 8), card('S', 6)]]
    const honest = applyAction(position(hands, { human: 1 }), 0, { type: 'attack', cardId: 'H7' })
    expect(legalActions(honest, 1)).not.toContainEqual({ type: 'defend', cardId: 'D8', pair: 0 })

    const person = applyAction(position(hands, { human: 1, cheat: true }), 0, { type: 'attack', cardId: 'H7' })
    expect(legalActions(person, 1)).toContainEqual({ type: 'defend', cardId: 'D8', pair: 0 })
    const covered = applyAction(person, 1, { type: 'defend', cardId: 'D8', pair: 0 })
    // Nothing more to throw in, so the covered round goes straight to the discard.
    expect(covered.discard.map((c) => c.id).sort()).toEqual(['D8', 'H7'])

    const bot = applyAction(position(hands, { human: 0, cheat: true }), 0, { type: 'attack', cardId: 'H7' })
    expect(legalActions(bot, 1)).not.toContainEqual({ type: 'defend', cardId: 'D8', pair: 0 })
  })
})

describe('catching a cheater', () => {
  const hands = () => [[card('H', 7), card('D', 9)], [card('D', 8), card('S', 6)]]

  it('sometimes sends the cheat back and makes the cheater take the table', () => {
    let caught = 0
    const runs = 200
    for (let seed = 1; seed <= runs; seed++) {
      const start = applyAction(position(hands(), { human: 1, cheat: true, seed }), 0, { type: 'attack', cardId: 'H7' })
      const s = applyAction(start, 1, { type: 'defend', cardId: 'D8', pair: 0 })
      if (s.lastCaught) {
        caught++
        expect(s.lastCaught).toEqual({ by: 0, player: 1 })
        // The round closed as a take: the cheater holds the attack and the returned card.
        expect(s.players[1].hand.map((c) => c.id).sort()).toEqual(expect.arrayContaining(['D8', 'H7', 'S6']))
        expect(s.discard.length).toBe(0)
      } else expect(s.discard.map((c) => c.id).sort()).toEqual(['D8', 'H7'])
    }
    expect(caught / runs).toBeGreaterThan(0.18)
    expect(caught / runs).toBeLessThan(0.42)
  })

  it('never catches an honest cover or a game without bots', () => {
    const honest = hands()
    honest[1] = [card('H', 10), card('S', 6)]
    for (let seed = 1; seed <= 50; seed++) {
      const start = applyAction(position(honest, { human: 1, cheat: true, seed }), 0, { type: 'attack', cardId: 'H7' })
      expect(applyAction(start, 1, { type: 'defend', cardId: 'H10', pair: 0 }).lastCaught).toBeFalsy()
    }
    for (let seed = 1; seed <= 50; seed++) {
      const start = applyAction(position(hands(), { humans: [0, 1], human: 1, cheat: true, seed }), 0, { type: 'attack', cardId: 'H7' })
      expect(applyAction(start, 1, { type: 'defend', cardId: 'D8', pair: 0 }).lastCaught).toBeFalsy()
    }
  })
})

describe('accusing a bot cheater', () => {
  const start = (seed: number) => applyAction(position([[card('H', 7), card('D', 9)], [card('D', 8), card('S', 6)]], { human: 0, cheat: true, seed }), 0, { type: 'attack', cardId: 'H7' })

  it('lets a bot bluff and a person catch it', () => {
    let bluffed = 0
    for (let seed = 1; seed <= 200; seed++) {
      const s0 = start(seed)
      const a = chooseAction(s0, 1)
      if (a.type !== 'bluff') continue
      bluffed++
      const s = applyAction(s0, 1, a)
      expect(s.table[0].defense).not.toBeNull()
      const caught = applyAction(s, 0, { type: 'accuse', pair: 0 })
      expect(caught.lastCaught).toEqual({ by: 0, player: 1 })
      expect(caught.taking).toBe(true)
      expect(caught.players[1].hand.length).toBe(2)
    }
    expect(bluffed / 200).toBeGreaterThan(0.18)
    expect(bluffed / 200).toBeLessThan(0.42)
  })

  it('treats a wrong accusation as a false alarm', () => {
    const base = position([[card('H', 7), card('D', 9)], [card('H', 10), card('S', 6)]], { human: 0, cheat: true, seed: 1 })
    const s0 = applyAction(base, 0, { type: 'attack', cardId: 'H7' })
    const s = applyAction(s0, 1, { type: 'defend', cardId: 'H10', pair: 0 })
    const r = applyAction(s, 0, { type: 'accuse', pair: 0 })
    expect(r.falseAlarm).toEqual({ by: 0 })
    expect(r.table[0].defense).not.toBeNull()
  })

  it('does not let bots bluff in an honest game', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s0 = applyAction(position([[card('H', 7), card('D', 9)], [card('D', 8), card('S', 6)]], { human: 0, seed }), 0, { type: 'attack', cardId: 'H7' })
      expect(chooseAction(s0, 1).type).toBe('take')
    }
  })
})

describe('cheating only once', () => {
  const twoPeople = (seed = 1) => applyAction(position([[card('H', 7), card('D', 9)], [card('D', 8), card('S', 6)]], { humans: [0, 1], human: 0, cheat: true, seed }), 0, { type: 'attack', cardId: 'H7' })

  it('lets one person catch another who covered with the wrong card', () => {
    const s = applyAction(twoPeople(), 1, { type: 'defend', cardId: 'D8', pair: 0 })
    const caught = applyAction(s, 0, { type: 'accuse', pair: 0 })
    expect(caught.lastCaught).toEqual({ by: 0, player: 1 })
    expect(caught.taking).toBe(true)
    expect(caught.caught).toEqual([1])
  })

  it('takes cheating away from whoever was caught', () => {
    let s = applyAction(twoPeople(), 1, { type: 'defend', cardId: 'D8', pair: 0 })
    s = applyAction(s, 0, { type: 'accuse', pair: 0 })
    expect(canCheat(s, 1)).toBe(false)
    // the next round: the cheater defends again but now only an honest card is legal
    const next: GameState = { ...structuredClone(s), table: [{ attack: card('S', 10), defense: null }], taking: false, passed: [], attacker: 0, defender: 1 }
    next.players[1].hand = [card('D', 8), card('S', 12)]
    const defends = legalActions(next, 1).filter((a) => a.type === 'defend')
    expect(defends.map((a) => (a as { cardId: string }).cardId)).toEqual(['S12'])
  })

  it('does not blame an honest cover', () => {
    const s0 = applyAction(position([[card('H', 7), card('D', 9)], [card('H', 10), card('S', 6)]], { humans: [0, 1], human: 0, cheat: true, seed: 1 }), 0, { type: 'attack', cardId: 'H7' })
    const s = applyAction(s0, 1, { type: 'defend', cardId: 'H10', pair: 0 })
    expect(applyAction(s, 0, { type: 'accuse', pair: 0 }).falseAlarm).toEqual({ by: 0 })
  })

  it('stops a caught bot from bluffing again', () => {
    const s0 = applyAction(position([[card('H', 7), card('D', 9)], [card('D', 8), card('S', 6)]], { human: 0, cheat: true, seed: 1 }), 0, { type: 'attack', cardId: 'H7' })
    for (let seed = 1; seed <= 200; seed++) {
      const s = { ...structuredClone(s0), caught: [1], options: { ...s0.options, seed } }
      expect(chooseAction(s, 1).type).toBe('take')
    }
  })
})

describe('cheating on a throw-in', () => {
  const lead = (cheat: boolean, seed = 1) => {
    const s = applyAction(position([[card('H', 7), card('D', 9), card('C', 12)], [card('H', 10), card('S', 6), card('S', 7)]], { human: 0, cheat, seed }), 0, { type: 'attack', cardId: 'H7' })
    return applyAction(s, 1, { type: 'defend', cardId: 'H10', pair: 0 })
  }

  it('is refused without the cheater setting', () => {
    expect(legalActions(lead(false), 0).some((a) => a.type === 'attack' && a.cardId === 'D9')).toBe(false)
    expect(canThrow(lead(false), 0, ['D9'])).toBe(false)
  })
  it('lets a person throw in a card of any rank, and a bot may catch it', () => {
    let kept = 0
    let caught = 0
    for (let seed = 1; seed <= 60; seed++) {
      const s0 = lead(true, seed)
      expect(canThrow(s0, 0, ['D9'])).toBe(true)
      const s = applyAction(s0, 0, { type: 'throw', cardIds: ['D9'] })
      if (s.lastCaught) {
        caught++
        expect(s.table).toHaveLength(1)
        expect(s.players[0].hand.some((c) => c.id === 'D9')).toBe(true)
        expect(s.caught).toEqual([0])
        expect(canCheat(s, 0)).toBe(false)
      } else {
        kept++
        expect(s.table).toHaveLength(2)
      }
    }
    expect(caught).toBeGreaterThan(0)
    expect(kept).toBeGreaterThan(0)
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

describe('bot emotes', () => {
  const fresh = () => newGame({ players: 3, deckSize: 36, mode: 'podkidnoy', names: ['Вы', 'Лиса', 'Мишка'], human: 0, seed: 7 })
  it('a bot that gets caught sulks and the catcher gloats', () => {
    const prev = fresh()
    const next = { ...structuredClone(prev), lastCaught: { by: 1, player: 2 } }
    expect(botReaction(prev, next, () => 0)).toEqual({ seat: 1, emoji: '😎' })
    const sulk = { ...structuredClone(prev), lastCaught: { by: 0, player: 2 } }
    expect(botReaction(prev, sulk, () => 0)?.seat).toBe(2)
  })
  it('a game that ends with a bot as the fool makes it complain', () => {
    const prev = fresh()
    const next = { ...structuredClone(prev), over: true, loser: 1 }
    expect(botReaction(prev, next, () => 0)).toEqual({ seat: 1, emoji: '😡' })
  })
  it('stays quiet when nothing happened', () => {
    const s = fresh()
    expect(botReaction(s, structuredClone(s), () => 0)).toBeNull()
  })
  it('replies to a person only some of the time', () => {
    const s = fresh()
    expect(botReply('😂', s, () => 0.9)).toBeNull()
    expect(botReply('😂', s, () => 0)?.emoji).toBe('😂')
  })
})

describe('bots catching bots', () => {
  it('a stronger table spots cheats more often', () => {
    expect(catchChance('easy')).toBeLessThan(catchChance('normal'))
    expect(catchChance('normal')).toBeLessThan(catchChance('hard'))
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
  const card = (suit: Card['suit'], rank: number): Card => ({ id: `${suit}${rank}`, suit, rank })
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
