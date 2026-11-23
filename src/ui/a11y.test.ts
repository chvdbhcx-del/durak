import { describe, expect, it } from 'vitest'
import { spokenCard } from '../engine/cards'
import { newGame } from '../engine/game'
import { tipFor } from './Coach'
import { tableSummary } from './GameScreen'
import { past } from './pickers'

describe('spoken cards', () => {
  it('names cards the way people say them', () => {
    expect(spokenCard({ suit: 'S', rank: 14 })).toBe('туз пик')
    expect(spokenCard({ suit: 'H', rank: 12 }, 'acc')).toBe('даму червей')
    expect(spokenCard({ suit: 'D', rank: 6 }, 'ins')).toBe('шестёркой бубен')
    expect(spokenCard({ suit: 'C', rank: 10 })).toBe('десятка треф')
    expect(spokenCard({ suit: 'S', rank: 0 })).toBe('карта')
  })
  it('agrees verbs with the bots names', () => {
    expect(past('Лиса', 'забрал', 'забрала')).toBe('забрала')
    expect(past('Волк', 'забрал', 'забрала')).toBe('забрал')
  })
})

describe('table summary and first-game tips', () => {
  const g = newGame({ players: 2, deckSize: 36, mode: 'podkidnoy', cheat: false, firstBeatFive: false, names: ['Вы', 'Лиса'], human: 0, level: 'easy', stake: 0 })
  it('reads the whole table out', () => {
    const text = tableSummary(g, 0)
    expect(text).toMatch(/^Козырь: /)
    expect(text).toContain('В колоде 24 карты')
    expect(text).toContain('Стол пуст')
  })
  it('offers a tip only on the player own turn', () => {
    const tip = tipFor(g, 0)
    if (g.attacker === 0) expect(tip).toBe('lead')
    else expect(tip).toBeNull()
  })
})
