import { describe, expect, it } from 'vitest'
import { COMFY_STEP, fanLayout, handLayout } from './fan'

describe('fanLayout', () => {
  it('is symmetric around the middle card', () => {
    for (const n of [2, 3, 6, 12, 13, 20, 30]) {
      const f = fanLayout(n, 90, 358)
      for (let i = 0; i < n; i++) {
        expect(f.angle(i)).toBeCloseTo(-f.angle(n - 1 - i), 9)
        expect(f.drop(i)).toBeCloseTo(f.drop(n - 1 - i), 9)
      }
    }
  })

  it('fits the room, corners included', () => {
    for (const [cw, room] of [[90, 358], [62, 288], [130, 860]]) {
      for (let n = 1; n <= 24; n++) {
        const f = fanLayout(n, cw, room)
        expect(f.width + 2 * f.pad).toBeLessThanOrEqual(room + 0.001)
      }
    }
  })

  it('turns and drops evenly, more towards the edges', () => {
    const f = fanLayout(13, 90, 358)
    const turns = Array.from({ length: 12 }, (_, i) => f.angle(i + 1) - f.angle(i))
    for (const t of turns) expect(t).toBeCloseTo(turns[0], 9)
    expect(f.drop(6)).toBe(0)
    for (let i = 6; i < 12; i++) expect(f.drop(i + 1)).toBeGreaterThan(f.drop(i))
    expect(Math.abs(f.angle(0))).toBeLessThanOrEqual(11.0001)
  })

  it('keeps a single card straight', () => {
    const f = fanLayout(1, 90, 358)
    expect(f.angle(0)).toBe(0)
    expect(f.drop(0)).toBe(0)
    expect(f.width).toBe(90)
  })
})

describe('handLayout', () => {
  it('keeps one row while the cards are wide enough to hit', () => {
    const h = handLayout(12, 83, 328)
    expect(h.rows).toBe(1)
    expect(h.lift).toBe(0)
  })

  it('splits a big hand on a narrow screen into two rows with a comfortable step', () => {
    const h = handLayout(18, 83, 328)
    expect(h.rows).toBe(2)
    const front = [...Array(18).keys()].filter((i) => h.spot(i).row === 1)
    expect(front.length).toBe(9)
    expect(h.spot(1).left - h.spot(0).left).toBeGreaterThanOrEqual(COMFY_STEP)
    expect(h.width + 2 * h.pad).toBeLessThanOrEqual(328.001)
  })

  it('picks the card under a point in either row', () => {
    const h = handLayout(18, 83, 328)
    for (let i = 0; i < 18; i++) {
      const s = h.spot(i)
      expect(h.pick(s.left + 83 / 2, s.top + 4)).toBe(i)
    }
    expect(h.sameRow(0, 8)).toBe(true)
    expect(h.sameRow(8, 9)).toBe(false)
  })

  it('stays one row on a wide screen', () => {
    expect(handLayout(18, 120, 860).rows).toBe(1)
  })
})
