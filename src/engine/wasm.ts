import type { Level } from './bot'
import type { Action, GameState } from './game'

/** The Rust engine (engine-rs/) compiled to WebAssembly: the same bots, many times faster. */
export interface WasmBot {
  choose(game: GameState, actor: number, level: Level | undefined, budgetMs: number): Action
}

interface Exports {
  memory: WebAssembly.Memory
  alloc(len: number): number
  dealloc(ptr: number, len: number): void
  choose(ptr: number, len: number, actor: number, level: number, budgetMs: number): number
  out_ptr(): number
}

const LEVELS: Record<Level, number> = { easy: 0, normal: 1, hard: 2 }

export async function loadWasmBot(bytes: BufferSource | Promise<Response>): Promise<WasmBot> {
  const imports = { env: { now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) } }
  const instance =
    bytes instanceof Promise
      ? (await WebAssembly.instantiateStreaming(bytes, imports).catch(async () => WebAssembly.instantiate(await (await bytes).arrayBuffer(), imports))).instance
      : (await WebAssembly.instantiate(bytes, imports)).instance
  const x = instance.exports as unknown as Exports
  const enc = new TextEncoder()
  const dec = new TextDecoder()
  return {
    choose(game, actor, level, budgetMs) {
      const input = enc.encode(JSON.stringify(game))
      const ptr = x.alloc(input.length)
      new Uint8Array(x.memory.buffer, ptr, input.length).set(input)
      const len = x.choose(ptr, input.length, actor, level ? LEVELS[level] : -1, budgetMs)
      x.dealloc(ptr, input.length)
      const text = dec.decode(new Uint8Array(x.memory.buffer, x.out_ptr(), len))
      if (text.startsWith('!')) throw new Error(text.slice(1))
      return JSON.parse(text) as Action
    },
  }
}
