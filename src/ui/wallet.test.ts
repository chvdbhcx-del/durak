import { describe, expect, it } from 'vitest'
import { affordableStake, isBroke, NEW_WALLET, placeWager, refill, settle, takeBonus } from './wallet'

describe('wallet', () => {
  it('the fool pays every other player the stake', () => {
    const w = placeWager(NEW_WALLET, 7, 100, 4, 1)
    expect(w.balance).toBe(700)
    const r = settle(w, 7, 'loss')!
    expect(r.delta).toBe(-300)
    expect(r.wallet.balance).toBe(700)
    expect(r.wallet.wager).toBeNull()
  })
  it('a win pays the stake times the bot level bonus', () => {
    const r = settle(placeWager(NEW_WALLET, 1, 100, 2, 2), 1, 'win')!
    expect(r.delta).toBe(200)
    expect(r.wallet.balance).toBe(1200)
    expect(r.wallet.best).toBe(1200)
  })
  it('a draw returns the money', () => {
    const r = settle(placeWager(NEW_WALLET, 1, 500, 3, 1.5), 1, 'draw')!
    expect(r.delta).toBe(0)
    expect(r.wallet.balance).toBe(1000)
  })
  it('pays only once and only for its own game', () => {
    const w = placeWager(NEW_WALLET, 1, 100, 2, 1)
    expect(settle(w, 2, 'win')).toBeNull()
    expect(settle(settle(w, 1, 'win')!.wallet, 1, 'win')).toBeNull()
  })
  it('never stakes more than the balance', () => {
    expect(affordableStake(NEW_WALLET, 2500, 2)).toBe(500)
    expect(placeWager(NEW_WALLET, 1, 2500, 2, 1).balance).toBe(1000)
  })
  it('an abandoned game keeps its money lost', () => {
    const w = placeWager(placeWager(NEW_WALLET, 1, 100, 2, 1), 2, 0, 2, 1)
    expect(w.balance).toBe(900)
    expect(w.lost).toBe(100)
    expect(w.wager).toBeNull()
  })
  it('a room game does not touch a paused bot game', () => {
    const w = placeWager(placeWager(NEW_WALLET, 1, 100, 2), 9, 100, 3, 1, 'roomWager')
    expect(w.balance).toBe(700)
    const r = settle(w, 9, 'win', 'roomWager')!
    expect(r.delta).toBe(100)
    expect(r.wallet.wager?.seed).toBe(1)
  })
  it('daily bonus once a day, refill only when broke', () => {
    const w = takeBonus(NEW_WALLET, '2026-11-04')
    expect(w.balance).toBe(1200)
    expect(takeBonus(w, '2026-11-04').balance).toBe(1200)
    expect(isBroke(w)).toBe(false)
    const broke = { ...NEW_WALLET, balance: 20 }
    expect(refill(broke).balance).toBe(500)
    expect(refill(w)).toBe(w)
  })
})
