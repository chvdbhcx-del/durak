// Runs the bots' thinking off the main thread, so a hard bot's look-ahead never stalls a card in flight.
// The Rust engine does the thinking; if WebAssembly can't load, the TypeScript bot takes over.
import { chooseAction, LOOKAHEAD, type Level } from './bot'
import type { GameState } from './game'
import { loadWasmBot, type WasmBot } from './wasm'
import wasmUrl from './durak_engine.wasm?url'

let wasm: Promise<WasmBot | null> | null = null
const engine = () => (wasm ??= loadWasmBot(fetch(wasmUrl)).catch(() => null))

self.onmessage = async (e: MessageEvent<{ id: number; game: GameState; actor: number; level?: Level }>) => {
  const { id, game, actor, level } = e.data
  const rust = await engine()
  if (rust) {
    try {
      return postMessage({ id, action: rust.choose(game, actor, level, LOOKAHEAD.budgetMs), engine: 'rust' })
    } catch {
      /* fall through to the TypeScript bot */
    }
  }
  try {
    postMessage({ id, action: chooseAction(game, actor, level), engine: 'ts' })
  } catch (err) {
    postMessage({ id, error: String(err) })
  }
}
