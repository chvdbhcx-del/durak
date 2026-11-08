import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { chooseAction, LOOKAHEAD, type Level } from './bot'
import { applyAction, currentActor, GameState, newGame, Options } from './game'
import { loadWasmBot, type WasmBot } from './wasm'

// The Rust engine must play exactly like the TypeScript one: same moves from the same positions.
let rust: WasmBot
beforeAll(async () => {
  rust = await loadWasmBot(readFileSync(new URL('./durak_engine.wasm', import.meta.url)))
})

function positions(opts: Partial<Options>, every: number, cap: number): GameState[] {
  let g = newGame({ players: 3, deckSize: 36, mode: 'podkidnoy', names: [], human: -1, humans: [], level: 'normal', ...opts })
  const out: GameState[] = []
  for (let i = 0; i < 500 && !g.over && out.length < cap; i++) {
    const actor = currentActor(g)
    if (actor === null) break
    if (i % every === 0) out.push(g)
    g = applyAction(g, actor, chooseAction(g, actor, opts.level ?? 'normal', true))
  }
  return out
}

describe('Rust engine', () => {
  for (const level of ['easy', 'normal'] as Level[])
    for (const mode of ['podkidnoy', 'perevodnoy'] as const)
      it(`chooses the same moves as TypeScript: ${level}, ${mode}`, () => {
        for (let seed = 1; seed <= 12; seed++) {
          for (const g of positions({ seed, mode, level, players: 2 + (seed % 4), deckSize: seed % 3 === 0 ? 52 : 36, cheat: seed % 2 === 0 }, 1, 400)) {
            const actor = currentActor(g)!
            expect(rust.choose(g, actor, level, 1e9)).toEqual(chooseAction(g, actor, level))
          }
        }
      })

  it('chooses the same moves as TypeScript: hard (look-ahead and endgame search)', () => {
    const saved = LOOKAHEAD.budgetMs
    LOOKAHEAD.budgetMs = 1e9
    try {
      for (let seed = 1; seed <= 3; seed++) {
        for (const g of positions({ seed, level: 'hard', players: 2 + (seed % 2) }, 9, 8)) {
          const actor = currentActor(g)!
          expect(rust.choose(g, actor, 'hard', 1e9)).toEqual(chooseAction(g, actor, 'hard'))
        }
      }
    } finally {
      LOOKAHEAD.budgetMs = saved
    }
  }, 120_000)

  it('reports broken input instead of crashing', () => {
    expect(() => rust.choose({} as GameState, 0, 'normal', 10)).toThrow()
  })
})
