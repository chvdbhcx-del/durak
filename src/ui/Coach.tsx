import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { currentActor, legalActions, type GameState } from '../engine/game'

/**
 * Wordless tips for the first games: a ghost finger shows what to do the first time each situation comes up
 * (lead a card, cover a card, take, say «Бито»), and the trump card glows once. Each tip is shown until the
 * player has done that move once, and only if they hesitate, so anyone who knows the game never sees it.
 */
type Tip = 'trump' | 'lead' | 'defend' | 'take' | 'pass'

const KEY = 'durak.coach'
function loadDone(): Set<Tip> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as Tip[])
  } catch {
    return new Set()
  }
}
function saveDone(done: Set<Tip>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...done]))
  } catch {
    /* storage unavailable: tips may show again next time */
  }
}

/** Which tip fits the table right now, if any. */
export function tipFor(g: GameState, me: number): Tip | null {
  if (g.over || g.players[me].out || currentActor(g) !== me) return null
  const legal = legalActions(g, me)
  if (g.defender === me && !g.taking) {
    if (legal.some((a) => a.type === 'defend')) return 'defend'
    if (legal.some((a) => a.type === 'take')) return 'take'
    return null
  }
  if (g.table.length === 0 && legal.some((a) => a.type === 'attack')) return 'lead'
  if (g.table.length > 0 && g.table.every((p) => p.defense) && legal.some((a) => a.type === 'pass')) return 'pass'
  return null
}

/** The move that counts as having learned a tip. */
const LEARNED: Record<Exclude<Tip, 'trump'>, string[]> = { lead: ['attack', 'throw'], defend: ['defend', 'transfer', 'bluff'], take: ['take'], pass: ['pass'] }

interface Point {
  x: number
  y: number
}
const centre = (el: Element | null): Point | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
}

/** Where the finger starts and ends for a tip, read from the table on screen. */
function pathFor(tip: Tip): { from: Point; to: Point | null } | null {
  if (tip === 'trump') {
    const from = centre(document.querySelector('.deck .trump-card')) ?? centre(document.querySelector('.trump-chip'))
    return from && { from, to: null }
  }
  if (tip === 'lead') {
    const cards = [...document.querySelectorAll('.hand .card.playable')]
    const from = centre(cards[Math.floor((cards.length - 1) / 2)] ?? null)
    const to = centre(document.querySelector('.battle')) ?? centre(document.querySelector('.felt'))
    return from && to ? { from, to } : null
  }
  if (tip === 'defend') {
    const from = centre(document.querySelector('.hand .card.beats') ?? document.querySelector('.hand .card.playable'))
    const open = [...document.querySelectorAll('.battle .pair')].find((p) => p.querySelectorAll('.card').length === 1) ?? null
    const to = centre(open)
    return from && to ? { from, to } : null
  }
  const from = centre(document.querySelector('.main-action'))
  return from && { from, to: null }
}

export function Coach({ game, me, ready }: { game: GameState; me: number; ready: boolean }) {
  const [done, setDone] = useState(loadDone)
  const [shown, setShown] = useState<Tip | null>(null)
  const [path, setPath] = useState<ReturnType<typeof pathFor>>(null)
  const still = useReducedMotion()

  // A move made by the player retires its tip for good.
  useEffect(() => {
    const a = game.lastAction
    if (!a || a.player !== me) return
    const learned = (Object.keys(LEARNED) as Exclude<Tip, 'trump'>[]).find((t) => LEARNED[t].includes(a.action.type))
    if (!learned || done.has(learned)) return
    const next = new Set(done).add(learned)
    saveDone(next)
    setDone(next)
  }, [game.lastAction, me, done])

  const fresh = game.discard.length === 0 && game.table.length === 0
  const wanted: Tip | null = !ready ? null : !done.has('trump') && fresh && game.deck.length > 0 ? 'trump' : tipFor(game, me)
  const tip = wanted && !done.has(wanted) ? wanted : null

  // Only a player who hesitates gets the tip; the trump glow comes right after the deal.
  useEffect(() => {
    setShown(null)
    if (!tip) return
    const t = setTimeout(() => setShown(tip), tip === 'trump' ? 400 : 2200)
    return () => clearTimeout(t)
  }, [tip, game])

  // The trump glow plays once, then counts as seen.
  useEffect(() => {
    if (shown !== 'trump') return
    const t = setTimeout(() => {
      const next = new Set(done).add('trump')
      saveDone(next)
      setDone(next)
    }, 2600)
    return () => clearTimeout(t)
  }, [shown, done])

  // Cards move and the screen turns: the path is read again every so often while a tip is up.
  useEffect(() => {
    if (!shown) return setPath(null)
    const read = () => setPath(pathFor(shown))
    read()
    const t = setInterval(read, 500)
    return () => clearInterval(t)
  }, [shown])

  const key = shown && path ? `${shown}-${Math.round(path.from.x)}-${Math.round(path.from.y)}-${Math.round(path.to?.x ?? 0)}` : null
  return (
    <AnimatePresence>
      {shown === 'trump' && path && (
        <m.span
          key="trump-glow"
          className="coach-glow"
          aria-hidden="true"
          style={{ left: path.from.x, top: path.from.y }}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: [0, 1, 0.4, 1, 0], scale: still ? 1 : [0.6, 1.1, 1, 1.1, 1.2] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 2.4, ease: 'easeInOut' }}
        />
      )}
      {shown && shown !== 'trump' && path && key && (
        <m.span key={key} className="coach-finger" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
          {path.to && !still ? (
            // drag: press on the card, carry it to the table, lift, repeat
            <m.span
              className="coach-hand"
              initial={{ x: path.from.x, y: path.from.y, opacity: 0 }}
              animate={{ x: [path.from.x, path.from.x, path.to.x, path.to.x], y: [path.from.y, path.from.y, path.to.y, path.to.y], opacity: [0, 1, 1, 0], scale: [1.1, 0.92, 0.92, 1.1] }}
              transition={{ duration: 2, times: [0, 0.2, 0.75, 1], repeat: Infinity, repeatDelay: 0.6, ease: 'easeInOut' }}
            >
              <FingerIcon />
            </m.span>
          ) : (
            // tap: a finger presses the button with a ripple
            <m.span className="coach-hand" initial={{ x: (path.to ?? path.from).x, y: (path.to ?? path.from).y }} animate={still ? { opacity: 1 } : { scale: [1, 0.85, 1] }} transition={{ duration: 1, repeat: Infinity, repeatDelay: 0.5 }}>
              <m.i className="coach-ripple" animate={still ? { opacity: 0.6 } : { scale: [0.4, 1.6], opacity: [0.7, 0] }} transition={{ duration: 1, repeat: Infinity, repeatDelay: 0.5 }} />
              <FingerIcon />
            </m.span>
          )}
        </m.span>
      )}
    </AnimatePresence>
  )
}

function FingerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40">
      <path
        fill="currentColor"
        stroke="rgba(0,0,0,.45)"
        strokeWidth="0.8"
        d="M9 2.5a1.75 1.75 0 0 1 1.75 1.75V10l.7-.1a1.7 1.7 0 0 1 1.95 1.1l.05-.02a1.7 1.7 0 0 1 2.2 1.15 1.7 1.7 0 0 1 2.35 1.4l.5 4.2A5.5 5.5 0 0 1 13 23h-1.3a5.5 5.5 0 0 1-4.3-2.07l-3.2-4a1.8 1.8 0 0 1 2.6-2.47l.45.4V4.25A1.75 1.75 0 0 1 9 2.5z"
      />
    </svg>
  )
}
