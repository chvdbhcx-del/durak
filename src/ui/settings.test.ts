import { describe, expect, it } from 'vitest'
import { addResult, EMPTY_STATS } from './settings'

describe('addResult slices', () => {
  const game = { at: 1, mode: 'podkidnoy' as const, deck: 36, players: 3, online: false, level: 'hard' as const, cheat: true }
  it('counts a game under its mode, rules, place and bot level', () => {
    const s = addResult(addResult(EMPTY_STATS, { ...game, result: 'win' }), { ...game, at: 2, result: 'loss' })
    expect(s.by).toMatchObject({ 'mode:podkidnoy': [1, 1, 0], 'rules:cheat': [1, 1, 0], 'where:bots': [1, 1, 0], 'level:hard': [1, 1, 0] })
    expect(s.by?.['where:online']).toBeUndefined()
  })
  it('leaves the bot level out of online games', () => {
    expect(addResult(EMPTY_STATS, { ...game, online: true, result: 'draw' }).by?.['level:hard']).toBeUndefined()
  })
  it('keeps working on stats saved before slices existed', () => {
    const old = { ...EMPTY_STATS, wins: 2 }
    expect(addResult(old, { ...game, result: 'win' }).wins).toBe(3)
  })
})
