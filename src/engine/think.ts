import { chooseAction, type Level } from './bot'
import type { Action, GameState } from './game'

/**
 * A bot's move, worked out in a Web Worker where one is available and on the spot otherwise
 * (tests, old browsers, the single-file preview).
 */
interface Job {
  game: GameState
  actor: number
  level?: Level
  done: (a: Action) => void
}

let worker: Worker | null | undefined
let seq = 0
const jobs = new Map<number, Job>()

const local = (j: Job) => {
  try {
    j.done(chooseAction(j.game, j.actor, j.level))
  } catch {
    /* the table moved on; the caller's timer asks again */
  }
}

function start(): Worker | null {
  if (worker !== undefined) return worker
  try {
    if (typeof Worker === 'undefined') return (worker = null)
    const w = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; action?: Action; error?: string; engine?: string }>) => {
      // Which engine answered (rust or ts), for the smoke tests and for anyone curious in the console.
      if (e.data.engine) (globalThis as { durakBotEngine?: string }).durakBotEngine = e.data.engine
      const job = jobs.get(e.data.id)
      jobs.delete(e.data.id)
      if (!job) return
      if (e.data.action) job.done(e.data.action)
      else local(job)
    }
    w.onerror = () => {
      // The worker couldn't load: think here from now on, and finish what was waiting.
      worker = null
      w.terminate()
      const waiting = [...jobs.values()]
      jobs.clear()
      waiting.forEach(local)
    }
    return (worker = w)
  } catch {
    return (worker = null)
  }
}

export function think(game: GameState, actor: number, level?: Level): Promise<Action> {
  return new Promise((done) => {
    const job: Job = { game, actor, level, done }
    const w = start()
    if (!w) return local(job)
    const id = ++seq
    jobs.set(id, job)
    w.postMessage({ id, game, actor, level })
  })
}
