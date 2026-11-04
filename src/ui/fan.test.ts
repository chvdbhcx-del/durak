import { describe, expect, it } from 'vitest'
import { fanLayout } from './fan'

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
