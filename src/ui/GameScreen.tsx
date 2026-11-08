import { AnimatePresence, LayoutGroup, motion, useDragControls, type DragControls, type PanInfo } from 'framer-motion'
import { Coin, Payout } from './Money'
import { formatCoins, type PayoutInfo, type Wager } from './wallet'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { beats, Card, rankLabel, sortHand, SUIT_NAME } from '../engine/cards'
import { EMOTES, type Emote } from '../engine/emotes'
import type { Friends } from '../net/useFriends'
import { Action, canThrow, currentActor, gameIdOf, GameState, HAND_SIZE, legalActions, previewAction } from '../engine/game'
import { CardView, flightEnd, type Flight } from './CardView'
import { notify, tap } from './native'
import { playCard, playDeal, playSweep } from './sfx'
import { BOT_NAMES } from './pickers'
import { AVATARS } from './settings'
import { SuitIcon } from './SuitIcon'
import { fanLayout } from './fan'

const DEAL_STEP_MS = 120

export const pop = {
  initial: { opacity: 0, scale: 0.85, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.85, y: 6 },
  transition: { type: 'spring', stiffness: 500, damping: 30 },
} as const

export const fade = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.18 },
} as const

export type Result = 'win' | 'loss' | 'draw'

/** A bot tournament in progress: how many games are played and how often each seat was the fool. */
export interface Series {
  total: number
  played: number
  fools: number[]
}

interface Props {
  game: GameState
  me: number
  act: (action: Action) => void
  paused: boolean
  botDelay: number
  /** called when a bot should move; left out for guests, whose bots run on the host */
  onBotTurn?: (actor: number) => void
  /** called while the defender is covering, so a bot may throw in without waiting its turn */
  onBotThrow?: () => void
  onFinished: (result: Result, loser: number | null) => void
  series?: Series | null
  /** this player's money on the game, if any */
  wager?: Wager | null
  payout?: PayoutInfo | null
  emote?: Emote | null
  /** online rooms: lets a player turn an opponent into a friend */
  friends?: Friends
  onEmote?: (emoji: string) => void
  onExit: () => void
  onOpenSettings: () => void
  /** left out when this player can't start the next game (an online guest) */
  onPlayAgain?: () => void
  room?: { code: string; notice: string | null; reconnecting?: boolean; roster?: { seat: number; name: string; fid?: string }[]; turnMs?: number }
}

/** The current width of an element, kept up to date as it resizes. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Card sizes in px: table cards and the bigger cards in your own hand. */
function useCardSizes() {
  const calc = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    // Short landscape screens (a phone on its side) size cards by height, everything else mostly by width.
    const flat = w > h && h < 560
    const table = Math.round(flat ? Math.max(46, h * 0.15) : Math.max(52, Math.min(128, Math.min(w * 0.185, h * 0.105))))
    const hand = Math.round(flat ? Math.max(54, h * 0.17) : Math.max(62, Math.min(130, Math.min(w * 0.232, h * 0.122))))
    return { table, hand, flat }
  }
  const [s, setS] = useState(calc)
  useEffect(() => {
    const on = () => setS(calc())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return s
}

function hashTilt(id: string) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0
  return (Math.abs(h) % 1000) / 1000
}

interface Banner {
  key: number
  text: string
  tone: 'good' | 'bad' | 'info'
}

const DEAL_FLIGHT: Flight = { kind: 'draw', delay: 0 }
/** how the hand fans out under a finger or pointer */
const FAN_SPRING = { type: 'spring', stiffness: 320, damping: 30 } as const

/** Deals the opening hands one card at a time, round-robin, whenever a new game starts. */
function useDealing(game: GameState) {
  const seed = gameIdOf(game)
  const total = game.players.length * HAND_SIZE
  // One step past the last card: the deal lasts until the last card has landed, so it flies like the others.
  const done = total + 1
  const fresh = game.discard.length === 0 && game.table.length === 0 && !game.lastAction
  const [state, setState] = useState({ seed, dealt: fresh ? 0 : done })
  const step = state.seed === seed ? state.dealt : fresh ? 0 : done
  const dealing = step < done
  useEffect(() => {
    if (!dealing) return
    const wait = step === 0 ? 450 : step === total ? flightEnd(DEAL_FLIGHT) * 1000 : DEAL_STEP_MS
    const t = setTimeout(() => setState({ seed, dealt: step + 1 }), wait)
    return () => clearTimeout(t)
  }, [step, dealing, seed, total])
  return { dealt: Math.min(step, total), dealing }
}

/** Where each card is, so a move between zones can be given its own flight. */
function zoneMap(g: GameState): Map<string, string> {
  const zones = new Map<string, string>()
  g.deck.forEach((c) => zones.set(c.id, 'deck'))
  g.discard.forEach((c) => zones.set(c.id, 'discard'))
  g.table.forEach((p) => {
    zones.set(p.attack.id, 'table')
    if (p.defense) zones.set(p.defense.id, 'table')
  })
  g.players.forEach((p) => p.hand.forEach((c) => zones.set(c.id, `hand-${p.id}`)))
  return zones
}

/** How many cards of the deck and the discard pile are actually drawn. */
const PILE_SHOWN = 9

// The "tap a suspicious card" tip shows until the player has tried it once.
const ACCUSE_KEY = 'durak.accuseKnown'
function accuseKnown() {
  try {
    return localStorage.getItem(ACCUSE_KEY) === '1'
  } catch {
    return false
  }
}
function rememberAccuse() {
  try {
    localStorage.setItem(ACCUSE_KEY, '1')
  } catch {
    /* storage unavailable: the tip just keeps showing */
  }
}

export function GameScreen({ game, me, act, paused, botDelay, onBotTurn, onBotThrow, onFinished, series, wager, payout, emote, onEmote, friends, onExit, onOpenSettings, onPlayAgain, room }: Props) {
  const { table: cw, hand: hw, flat } = useCardSizes()
  const [stripRef, stripW] = useWidth<HTMLElement>()
  const [meRef, meW] = useWidth<HTMLElement>()
  const [controlsRef, controlsW] = useWidth<HTMLDivElement>()
  const { dealt, dealing } = useDealing(game)
  const zones = useMemo(() => zoneMap(game), [game])
  const prevZones = useRef(zones)
  const gameId = gameIdOf(game)
  const prevSeed = useRef(gameId)
  /** a card waiting for the player to pick which attack it covers */
  const [selected, setSelected] = useState<string | null>(null)
  /** moves lined up on the table, made only when the player confirms */
  const [plan, setPlan] = useState<Action[]>([])
  const [banner, setBanner] = useState<Banner | null>(null)
  const [bubble, setBubble] = useState<{ seat: number; text: string; key: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [hot, setHot] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  /** the card under a finger or pointer sliding over the fan: it rises and its neighbours part */
  const fanStore = useFanStore()
  const setFan = fanStore.set
  const slotControls = useRef(new Map<string, DragControls>())
  const press = useRef<{ x: number; y: number; id: string | null; mode: 'wait' | 'scrub' | 'drag' } | null>(null)
  // A finger lifted outside the hand (or a gesture the system took over) must not leave a card raised.
  useEffect(() => {
    const end = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      press.current = null
      setFan(null)
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [])
  const handIds = useRef<string[]>([])
  const prev = useRef<GameState>(game)
  const counted = useRef<number | null>(null)
  const lastDragEnd = useRef(0)

  const undealt = useMemo(() => {
    if (!dealing) return [] as Card[]
    const n = game.players.length
    // Opening hands keep their deal order: hand[r] is the r-th card dealt to that player.
    // Listed last-dealt first, so the next card to deal sits on top of the deck.
    const hidden: Card[] = []
    for (let r = HAND_SIZE - 1; r >= 0; r--) for (let p = n - 1; p >= 0; p--) if (r * n + p >= dealt && game.players[p].hand[r]) hidden.push(game.players[p].hand[r])
    return hidden
  }, [dealing, dealt, game])
  const hiddenIds = useMemo(() => new Set(undealt.map((c) => c.id)), [undealt])

  // After each round the table sweeps into the discard, then hands refill from the deck, one card at a time.
  const flights = useMemo(() => {
    const out = new Map<string, Flight>()
    const before = prevZones.current
    if (dealing || prevSeed.current !== gameIdOf(game)) return out
    const swept: string[] = []
    const taken: string[] = []
    const drawn: string[] = []
    const played: string[] = []
    for (const [id, zone] of zones) {
      const was = before.get(id)
      if (!was || was === zone) continue
      if (zone === 'discard') swept.push(id)
      else if (zone.startsWith('hand-') && was === 'deck') drawn.push(id)
      else if (zone.startsWith('hand-') && was === 'table') taken.push(id)
      // Another player's lead, cover or throw-in glides out of their fan onto the table.
      else if (zone === 'table' && was.startsWith('hand-') && was !== `hand-${me}`) played.push(id)
    }
    // A slight stagger between cards, kept within about a second however many cards move.
    const step = (n: number, most: number, total: number) => (n > 1 ? Math.min(most, total / (n - 1)) : 0)
    // Cards set off almost at once: a card waiting for its turn would sit frozen where it was.
    const sweepStep = step(swept.length, 0.08, 0.6)
    const takeStep = step(taken.length, 0.06, 0.45)
    swept.forEach((id, i) => out.set(id, { kind: 'discard', delay: 0.08 + i * sweepStep }))
    taken.forEach((id, i) => out.set(id, { kind: 'take', delay: 0.05 + i * takeStep }))
    // Refills follow close behind, while the swept or taken cards are still gliding.
    const start = out.size ? 0.45 : 0.05
    const drawStep = step(drawn.length, 0.09, 0.5)
    drawn.forEach((id, i) => out.set(id, { kind: 'draw', delay: start + i * drawStep }))
    const playStep = step(played.length, 0.14, 0.5)
    played.forEach((id, i) => out.set(id, { kind: 'play', delay: 0.02 + i * playStep }))
    return out
  }, [zones, dealing, gameId, me])
  useEffect(() => {
    prevZones.current = zones
    prevSeed.current = gameIdOf(game)
  }, [zones, gameId])

  // Sounds follow the flights: one shuffle for a sweep, one flick per card dealt.
  useEffect(() => {
    if (flights.size === 0) return
    const list = [...flights.values()]
    const sweep = list.filter((f) => f.kind === 'discard' || f.kind === 'take')
    if (sweep.length) playSweep(Math.min(...sweep.map((f) => f.delay)), sweep.length)
    list
      .filter((f) => f.kind === 'draw')
      .slice(0, 10)
      .forEach((f) => playDeal(f.delay))
  }, [flights])
  useEffect(() => {
    if (dealing && dealt > 0) playDeal()
  }, [dealt, dealing])

  // The next move waits until every card in flight has landed, so a turn never cuts a flight short.
  const [landed, setLanded] = useState(flights)
  const settling = flights.size > 0 && landed !== flights
  useEffect(() => {
    if (flights.size === 0) return
    const ms = Math.max(...[...flights.values()].map(flightEnd)) * 1000
    const t = setTimeout(() => setLanded(flights), ms)
    return () => clearTimeout(t)
  }, [flights])
  const waiting = dealing || settling
  /** opening hands fly out of the deck one by one */
  const flightOf = (id: string) => flights.get(id) ?? (dealing ? DEAL_FLIGHT : undefined)

  const actor = waiting ? null : currentActor(game)
  const legal = useMemo(() => (waiting ? [] : legalActions(game, me)), [game, waiting, me])

  // The table and hand as they would be after the lined-up moves; a plan that no longer fits is dropped.
  const preview = useMemo(() => {
    if (plan.length === 0 || dealing) return null
    try {
      return plan.reduce((s, a) => previewAction(s, me, a), game)
    } catch {
      return null
    }
  }, [game, plan, me, dealing])
  const staged = preview ? plan : []
  const view = preview ?? game
  const pending = useMemo(() => new Set(staged.flatMap((a) => (a.type === 'throw' ? a.cardIds : 'cardId' in a ? [a.cardId] : []))), [staged])
  const thrower = legal.some((a) => a.type === 'attack')
  const viewLegal = useMemo(() => (waiting || !preview ? legal : legalActions(view, me)), [waiting, preview, legal, view, me])

  const mine = view.players[me]
  const hand = useMemo(() => sortHand(mine.hand, game.trump).filter((c) => !hiddenIds.has(c.id)), [mine.hand, game.trump, hiddenIds])

  // Bots "think" before each move, longer when there is more on the table, so their plays can be followed.
  const botThinking = actor !== null && !game.players[actor].human && !game.over
  // A room's move clock restarts with every change at the table, as it does on the host.
  const turnTick = useRef({ game, n: 0 })
  if (turnTick.current.game !== game) turnTick.current = { game, n: turnTick.current.n + 1 }
  const timed = room?.turnMs && actor !== null && game.players[actor].human && !game.over ? room.turnMs : 0
  const clock = (seat: number) =>
    timed && actor === seat ? <span key={turnTick.current.n} className="turn-clock" aria-hidden="true" style={{ ['--turn' as string]: `${timed}ms` }} /> : null
  useEffect(() => {
    if (actor === null || !onBotTurn || paused || game.players[actor].human) return
    const weight = 0.75 + Math.random() * 0.5 + Math.min(game.table.length, 4) * 0.08
    const t = setTimeout(() => onBotTurn(actor), Math.round(botDelay * weight))
    return () => clearTimeout(t)
  }, [game, actor, paused, botDelay, onBotTurn])

  // Bots don't wait for the defender either: after a short look at the table, one may throw in.
  // The defender (a person or a bot) keeps covering meanwhile; whoever is quicker goes first.
  useEffect(() => {
    if (actor === null || actor !== game.defender || game.taking || game.table.length === 0 || game.over || !onBotThrow || paused) return
    if (!game.players.some((p, i) => !p.human && !p.out && i !== game.defender)) return
    const t = setTimeout(onBotThrow, Math.round(botDelay * (0.55 + Math.random() * 0.6)))
    return () => clearTimeout(t)
  }, [game, actor, paused, botDelay, onBotThrow])

  // Round results and notable moves become a short banner over the table.
  useEffect(() => {
    const before = prev.current
    prev.current = game
    if (before === game || gameIdOf(before) !== gameIdOf(game)) return
    const show = (text: string, tone: Banner['tone']) => setBanner({ key: Date.now(), text, tone })
    const c = game.lastCaught
    if (c && JSON.stringify(c) !== JSON.stringify(before.lastCaught)) {
      show(c.player === me ? `${game.players[c.by].name} заметил обман! Вы берёте и больше не мухлюете` : c.by === me ? `Поймали! ${game.players[c.player].name} берёт и больше не мухлюет` : `${game.players[c.by].name} поймал ${game.players[c.player].name} на обмане`, c.player === me ? 'bad' : 'good')
    }
    if (game.falseAlarm && JSON.stringify(game.falseAlarm) !== JSON.stringify(before.falseAlarm)) show(game.falseAlarm.by === me ? 'Всё честно' : `${game.players[game.falseAlarm.by].name} ошибся, всё честно`, 'info')
    const a = game.lastAction
    if (a && JSON.stringify(a) !== JSON.stringify(before.lastAction)) {
      // A throw of my own already made its sound when the cards were put down.
      if (['attack', 'defend', 'bluff', 'transfer', 'throw'].includes(a.action.type) && !(a.player === me && a.action.type === 'throw')) playCard()
      const who = game.players[a.player]
      if (a.action.type === 'transfer') show(a.player === me ? 'Вы перевели' : `${who.name} переводит`, 'info')
      else if (a.action.type === 'take') show(a.player === me ? 'Вы берёте' : `${who.name} берёт`, a.player === me ? 'bad' : 'good')
    }
    if (before.table.length > 0 && game.table.length === 0 && game.lastRound?.end === 'beaten') show('Бито', 'info')
    // A short speech bubble over the seat that just spoke, as at a real table.
    if (a && JSON.stringify(a) !== JSON.stringify(before.lastAction) && a.player !== me) {
      const word = a.action.type === 'take' ? 'Беру' : a.action.type === 'pass' ? (game.table.length === 0 ? 'Бито' : 'Пас') : null
      if (word) setBubble({ seat: a.player, text: word, key: Date.now() })
    }
    if (currentActor(game) === me && currentActor(before) !== me) tap('light')
    setSelected(null)
    setPlan([])
  }, [game, me])

  // Emotes from anyone stay on screen for a couple of seconds.
  const [liveEmote, setLiveEmote] = useState<Emote | null>(null)
  const [emoteOpen, setEmoteOpen] = useState(false)
  useEffect(() => {
    if (!emote || Date.now() - emote.key > 1500) return
    setLiveEmote(emote)
    const t = setTimeout(() => setLiveEmote((e) => (e === emote ? null : e)), 1400)
    return () => clearTimeout(t)
  }, [emote])

  useEffect(() => {
    if (!bubble) return
    const t = setTimeout(() => setBubble(null), 1600)
    return () => clearTimeout(t)
  }, [bubble])

  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(null), 1300)
    return () => clearTimeout(t)
  }, [banner])

  useEffect(() => {
    if (room?.notice) setBanner({ key: Date.now(), text: room.notice, tone: 'info' })
  }, [room?.notice])

  // Report the result once per finished game.
  useEffect(() => {
    if (!game.over || counted.current === gameIdOf(game)) return
    counted.current = gameIdOf(game)
    const result: Result = game.loser === null ? 'draw' : game.loser === me ? 'loss' : 'win'
    notify(result === 'loss' ? 'warning' : 'success')
    onFinished(result, game.loser)
  }, [game, me, onFinished])

  const play = (action: Action) => {
    setSelected(null)
    setPlan([])
    tap(action.type === 'take' ? 'medium' : 'light')
    act(action)
  }

  const confirm = () => {
    const moves = staged
    setSelected(null)
    setPlan([])
    tap('medium')
    for (const m of moves) act(m)
  }

  const transferSeat = nextDefender(game)
  const optionsFor = (cardId: string) => viewLegal.filter((a) => 'cardId' in a && a.cardId === cardId)
  // Leads and throw-ins go straight onto the table, one card at a time, whenever the rules allow:
  // there is no waiting for the defender to finish covering.
  const throwWith = (cardId: string): string[] | null => {
    if (!thrower || staged.length > 0) return null
    return canThrow(game, me, [cardId]) ? [cardId] : null
  }
  const canStage = (cardId: string) => !!throwWith(cardId) || optionsFor(cardId).length > 0

  const stage = (move: Action) => {
    // Covering, leading and throwing in are played straight away; only a transfer waits to be confirmed.
    if (move.type === 'throw') playCard()
    if (move.type === 'defend' || move.type === 'throw') return play(move)
    tap('light')
    setSelected(null)
    setPlan([...staged, move])
  }

  /** Puts a card from the hand on the table, aimed at `zone` when it was dragged somewhere. */
  const place = (cardId: string, zone?: string | null): boolean => {
    const ids = throwWith(cardId)
    if (ids) {
      if (zone && zone !== 'table' && !zone.startsWith('pair-')) return false
      stage({ type: 'throw', cardIds: ids })
      return true
    }
    const options = optionsFor(cardId)
    const defends = options.filter((a) => a.type === 'defend')
    const transfer = options.find((a) => a.type === 'transfer')
    let move: Action | undefined
    if (zone?.startsWith('pair-')) move = defends.find((a) => a.type === 'defend' && a.pair === Number(zone.slice(5)))
    else if (zone === `seat-${transferSeat}` || zone === 'transfer') move = transfer
    else if (zone === 'table') move = transfer ?? (defends.length === 1 ? defends[0] : undefined)
    else if (!zone) {
      if (defends.length === 1) move = defends[0]
      else if (defends.length > 1) {
        tap('light')
        setSelected((s) => (s === cardId ? null : cardId))
        return true
      } else move = transfer
    }
    if (!move) return false
    stage(move)
    return true
  }

  /** Takes a lined-up card back into the hand. */
  const unstage = (cardId: string) => {
    tap('light')
    const rest = staged.filter((a) => !('cardId' in a && a.cardId === cardId))
    try {
      rest.reduce((s, a) => previewAction(s, me, a), game)
      setPlan(rest)
    } catch {
      setPlan([])
    }
  }

  const playable = new Set(hand.filter((c) => canStage(c.id)).map((c) => c.id))
  const focus = dragging ?? selected
  const focusOptions = focus ? optionsFor(focus) : []
  const targetPairs = new Set(focusOptions.flatMap((a) => (a.type === 'defend' ? [a.pair] : [])))
  const focusTransfers = focusOptions.some((a) => a.type === 'transfer')
  // The dashed "+" slot that says a card of this rank can be passed on to the next player.
  const transferCards = staged.length === 0 ? hand.filter((c) => viewLegal.some((a) => a.type === 'transfer' && a.cardId === c.id)) : []
  const useTransferSlot = () => {
    const pick = (selected && transferCards.find((c) => c.id === selected)) || transferCards.slice().sort((a, b) => Number(a.suit === game.trump) - Number(b.suit === game.trump) || a.rank - b.rank)[0]
    if (pick) place(pick.id, 'transfer')
  }
  const tableTarget = !!dragging && (!!throwWith(dragging) || focusTransfers || targetPairs.size === 1)

  const onCard = (card: Card) => {
    if (Date.now() - lastDragEnd.current < 300) return
    if (selected === card.id) return setSelected(null)
    place(card.id)
  }

  // Drag and drop: the drop zone under the finger decides where the card goes.
  // The zones' boxes are read once per drag (not hit-tested on every pointer move, which is slow on phones).
  const zoneBoxes = useRef<{ name: string; r: DOMRect; area: number }[]>([])
  const readZones = () => {
    zoneBoxes.current = [...document.querySelectorAll<HTMLElement>('[data-drop]')]
      .filter((el) => !el.closest('.hand'))
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { name: el.dataset.drop ?? '', r, area: r.width * r.height }
      })
      .sort((a, b) => a.area - b.area)
  }
  const zoneAt = (info: PanInfo) => {
    const x = info.point.x - window.scrollX
    const y = info.point.y - window.scrollY
    // smallest first, so a seat or a pair wins over the felt behind it
    const hit = zoneBoxes.current.find(({ r }) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
    return hit?.name || null
  }

  const take = legal.find((a) => a.type === 'take')
  const pass = legal.find((a) => a.type === 'pass')
  const passLabel = game.taking ? 'Пусть берёт' : me === game.attacker ? 'Бито' : 'Пас'
  const myTurn = actor === me && !game.over
  const main: { label: string; tone: 'primary' | 'danger'; onClick?: () => void } =
    staged[0]?.type === 'transfer'
      ? { label: 'Перевести', tone: 'primary', onClick: confirm }
      : take && myTurn
          ? { label: 'Беру', tone: 'danger', onClick: () => play(take) }
          : pass && myTurn
            ? { label: passLabel, tone: 'primary', onClick: () => play(pass) }
            : { label: myTurn ? 'Ваш ход' : game.over ? 'Конец' : 'Ждём', tone: 'primary' }

  const n = game.players.length
  const opponents = Array.from({ length: n - 1 }, (_, k) => game.players[(me + 1 + k) % n])
  // The fan gets the width of its own row (beside the buttons on a phone lying on its side).
  const handRoom = Math.min(860, meW ? meW - (flat ? controlsW + 12 : 0) : window.innerWidth - 32 - (flat ? 240 : 0))
  const fanGeo = fanLayout(hand.length, hw, handRoom)
  const handStep = fanGeo.step
  handIds.current = hand.map((c) => c.id)
  const fanAt = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (hand.length === 0) return
    const i = hand.length > 1 ? Math.round((e.clientX - r.left - hw / 2) / handStep) : 0
    setFan(Math.max(0, Math.min(hand.length - 1, i)))
  }
  const miniW = Math.round(cw * 0.42)
  // Every opponent gets a slot of the same fixed width, so a big hand never pushes its neighbours aside
  // and the strip never scrolls. With many players the fans get narrower and the cards smaller.
  const seats = Math.max(1, opponents.length)
  const seatGap = seats >= 4 ? 4 : seats === 3 ? 10 : 20
  const stripWidth = stripW || Math.min(window.innerWidth, 1200) - 32
  const slotW = Math.min(200, Math.floor((stripWidth - seatGap * (seats - 1)) / seats))
  const compactSeats = slotW < 112
  const fanMax = Math.max(16, slotW - (compactSeats ? 8 : 24))
  const seatMini = Math.min(miniW, Math.round(fanMax * 0.62))
  const deckCards = [...game.deck.slice(1), ...undealt]
  const status = dealing ? 'Раздача…' : staged.length ? planText(staged, game) : selected ? 'Выберите карту на столе' : statusText(game, actor, me)
  const seriesDone = !!series && series.played >= series.total
  const worst = series ? Math.max(...series.fools) : 0
  const losers = series ? game.players.filter((_, i) => series.fools[i] === worst) : []
  const seriesTitle = !seriesDone ? '' : losers.length > 1 ? 'Ничья в турнире' : losers[0].id === me ? 'Турнир проигран' : 'Вы выиграли турнир'
  const resultTitle = game.loser === null ? 'Ничья' : game.loser === me ? 'Вы дурак' : 'Вы не дурак'

  return (
    <motion.div
      className={`app ${dragging ? 'is-dragging' : ''}`}
      style={{ ['--cw' as string]: `${cw}px`, ['--hw' as string]: `${hw}px`, ['--mini' as string]: `${miniW}px`, ['--zone-cw' as string]: `${Math.round(cw * 0.74)}px` }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.3 }}
    >
      <motion.header className="bar" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <span className="chips" title={`${game.options.deckSize} карт`}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={game.options.mode} className="chip" {...fade}>
              {game.options.mode === 'podkidnoy' ? 'Подкидной' : 'Переводной'}
            </motion.span>
          </AnimatePresence>
          {game.options.cheat && (
            <motion.span className="chip warn" {...fade}>
              Шулер
            </motion.span>
          )}
          {wager && (
            <motion.span className="chip stake-chip" {...fade} title="Ставка на партию">
              <Coin size={13} />
              {formatCoins(wager.stake)}
            </motion.span>
          )}
          {room?.code && (
            <span className="chip" title="Код комнаты">
              {room.code}
            </span>
          )}
        </span>
        <motion.button type="button" className="icon" aria-label="Меню" whileTap={{ scale: 0.9 }} onClick={onOpenSettings}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M4 6.5h16a1 1 0 1 1 0 2H4a1 1 0 0 1 0-2zm0 4.5h16a1 1 0 1 1 0 2H4a1 1 0 0 1 0-2zm0 4.5h16a1 1 0 1 1 0 2H4a1 1 0 0 1 0-2z" />
          </svg>
        </motion.button>
      </motion.header>
      {series && !game.over && (
        <motion.div className="series-strip" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} aria-label="Счёт турнира">
          <span>
            Турнир · {Math.min(series.played + 1, series.total)} из {series.total}
          </span>
          {game.players.map((p, i) => (
            <span key={p.id} className={series.fools[i] === worst && worst > 0 ? 'last' : ''}>
              {i === me ? 'Вы' : p.name} <b>{series.fools[i]}</b>
            </span>
          ))}
        </motion.div>
      )}

      <AnimatePresence>
        {room?.reconnecting && (
          <motion.div key="reconnecting" className="reconnecting" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <motion.span className="toast-dot" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
            Восстанавливаем связь…
          </motion.div>
        )}
      </AnimatePresence>

      <LayoutGroup>
        <section
          ref={stripRef}
          className={`opponents ${compactSeats ? 'compact' : ''}`}
          aria-label="Соперники"
          style={{ ['--seats' as string]: seats, ['--slot' as string]: `${slotW}px`, ['--seat-gap' as string]: `${seatGap}px`, ['--mini' as string]: `${seatMini}px` }}
        >
          <AnimatePresence initial>
            {opponents.map((p, idx) => {
              const cards = p.hand.filter((c) => !hiddenIds.has(c.id))
              const step = cards.length > 1 ? Math.min(seatMini * 0.42, (Math.min(seatMini * 2.6, fanMax) - seatMini) / (cards.length - 1)) : 0
              const role = p.out ? 'Вышел' : dealing ? null : p.id === game.defender ? (game.taking ? 'Берёт' : 'Отбивается') : p.id === game.attacker ? 'Атакует' : null
              const isTransferTarget = dragging !== null && focusTransfers && transferSeat === p.id
              return (
                <motion.div
                  key={`${gameIdOf(game)}-${p.id}`}
                  layout="position"
                  data-drop={`seat-${p.id}`}
                  className={`seat ${actor === p.id ? 'active' : ''} ${p.out ? 'out' : ''} ${isTransferTarget ? 'drop-ok' : ''} ${isTransferTarget && hot === `seat-${p.id}` ? 'drop-hot' : ''}`}
                  initial={{ opacity: 0, y: -14 }}
                  animate={{ opacity: p.out ? 0.45 : 1, y: 0 }}
                  exit={{ opacity: 0, y: -14 }}
                  transition={{ delay: idx * 0.06, type: 'spring', stiffness: 400, damping: 30 }}
                >
                  <div className="seat-head">
                    {clock(p.id)}
                    <motion.span className={`avatar ${p.human && room ? 'person' : ''} ${!p.human && BOT_NAMES.includes(p.name) ? 'emoji' : ''}`} animate={actor === p.id ? { scale: [1, 1.12, 1] } : { scale: 1 }} transition={actor === p.id ? { duration: 1.4, repeat: Infinity } : undefined}>
                      {!p.human && BOT_NAMES.includes(p.name) ? AVATARS[BOT_NAMES.indexOf(p.name)] : p.name[0]}
                    </motion.span>
                    <span className="seat-name">{p.name}</span>
                    {friends && room && p.human && (() => {
                      const fid = room.roster?.find((r) => r.seat === p.id)?.fid
                      if (!fid || fid === friends.fid) return null
                      const mine = friends.isFriend(fid)
                      return (
                        <button type="button" className={`seat-add ${mine ? 'done' : ''}`} aria-label={mine ? `${p.name} уже в друзьях` : `Добавить ${p.name} в друзья`} disabled={mine} onClick={() => friends.add(fid, p.name)}>
                          {mine ? '✓' : '+'}
                        </button>
                      )
                    })()}
                    <AnimatePresence>
                      {bubble?.seat === p.id && (
                        <motion.span key={bubble.key} className="bubble" initial={{ opacity: 0, y: 6, scale: 0.7 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.9 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }}>
                          {bubble.text}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    <AnimatePresence>
                      {liveEmote?.seat === p.id && (
                        <motion.span key={liveEmote.key} className="bubble emote" initial={{ opacity: 0, y: 8, scale: 0.4 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.7 }} transition={{ type: 'spring', stiffness: 460, damping: 18 }}>
                          {liveEmote.emoji}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    <AnimatePresence>
                      {botThinking && actor === p.id && (
                        <motion.span key="think" className="thinking" aria-label="думает" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}>
                          {[0, 1, 2].map((i) => (
                            <motion.i key={i} animate={{ y: [0, -3, 0], opacity: [0.35, 1, 0.35] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
                          ))}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    <motion.span key={cards.length} className="count" initial={{ scale: 1.35 }} animate={{ scale: 1 }}>
                      {cards.length}
                    </motion.span>
                  </div>
                  <motion.div className="mini-hand" animate={{ width: seatMini + step * Math.max(0, cards.length - 1) }} transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
                    {cards.map((c, i) => (
                      <CardView key={c.id} card={c} faceUp={false} trump={game.trump} size="mini" style={{ left: i * step }} flight={flightOf(c.id)} />
                    ))}
                  </motion.div>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span key={isTransferTarget ? 'transfer' : role ?? 'wait'} className={`role ${role || isTransferTarget ? '' : 'empty'}`} {...fade}>
                      {isTransferTarget ? (compactSeats ? 'Сюда' : 'Перевести сюда') : role ?? 'Ждёт'}
                    </motion.span>
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </section>

        <motion.section
          className={`felt ${tableTarget ? 'drop-ok' : ''} ${tableTarget && hot === 'table' ? 'drop-hot' : ''}`}
          data-drop="table"
          aria-label="Стол"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="deck-zone">
            <div className="deck">
              {game.deck.length > 0 && <CardView key={game.deck[0].id} card={game.deck[0]} faceUp={!dealing} trump={game.trump} className="trump-card" style={{ rotate: 90 }} />}
              {/* Only the top of the pile is drawn: the rest is hidden underneath, and every card on screen costs a layout measurement on each move. */}
              {deckCards.slice(-PILE_SHOWN).map((c, j) => {
                const i = Math.max(0, deckCards.length - PILE_SHOWN) + j
                return <CardView key={c.id} card={c} faceUp={false} trump={game.trump} className="stacked" style={{ x: -Math.min(i, 8) * 0.6, y: -Math.min(i, 8) * 0.6 }} />
              })}
              <AnimatePresence>
                {game.deck.length === 0 && !dealing && (
                  <motion.span className="trump-ghost" aria-label={`Козырь: ${SUIT_NAME[game.trump]}`} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 0.35, scale: 1 }} exit={{ opacity: 0 }}>
                    <SuitIcon suit={game.trump} size="100%" />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            {game.deck.length > 0 && (
              <span className="zone-label">
                <b>{deckCards.length + 1}</b>
              </span>
            )}
          </div>

          <div className="battle">
            {view.table.map((pair, i) => {
              const target = targetPairs.has(i)
              const attackPending = pending.has(pair.attack.id)
              const coverPending = !!pair.defense && pending.has(pair.defense.id)
              // Cheater mode: tapping a cover someone else laid down says "that's a trick".
              const accusable = !!game.options.cheat && !!pair.defense && me !== game.defender && game.players[me]?.human && !game.over && !game.taking && !coverPending
              const onPair = target && selected ? () => place(selected, `pair-${i}`) : attackPending ? () => unstage(pair.attack.id) : coverPending ? () => unstage(pair.defense!.id) : accusable ? () => (rememberAccuse(), play({ type: 'accuse', pair: i })) : undefined
              return (
                // No layout animation on the pair box itself: its cards carry their own, and a moving
                // pair under moving cards made them measure each other wrong and jump.
                <motion.div
                  key={pair.attack.id}
                  data-drop={`pair-${i}`}
                  className={`pair ${target ? 'target' : ''} ${target && hot === `pair-${i}` ? 'drop-hot' : ''} ${onPair ? 'tappable' : ''}`}
                  onClick={onPair}
                  role={onPair ? 'button' : undefined}
                  tabIndex={onPair ? 0 : undefined}
                  aria-label={target ? `Покрыть ${rankLabel(pair.attack.rank)} ${SUIT_NAME[pair.attack.suit]}` : accusable ? 'Обвинить в обмане' : onPair ? 'Вернуть карту в руку' : undefined}
                  onKeyDown={onPair ? (e) => (e.key === 'Enter' || e.key === ' ') && onPair() : undefined}
                  animate={target && !dragging ? { y: [0, -4, 0] } : { y: 0, scale: target && hot === `pair-${i}` ? 1.06 : 1 }}
                  transition={target && !dragging ? { duration: 1, repeat: Infinity, ease: 'easeInOut' } : { type: 'spring', stiffness: 400, damping: 30 }}
                >
                  <CardView card={pair.attack} faceUp trump={game.trump} className={attackPending ? 'pending' : ''} flight={flightOf(pair.attack.id)} />
                  {pair.defense && <CardView card={pair.defense} faceUp trump={game.trump} className={`cover ${coverPending ? 'pending' : ''}`} style={{ rotate: 7 }} flight={flightOf(pair.defense.id)} />}
                </motion.div>
              )
            })}
            {/* popLayout takes the leaving slot out of the row at once, so the pairs glide over instead of jumping once it is gone */}
            <AnimatePresence mode="popLayout">
              {transferCards.length > 0 && (
                <motion.button
                  key="transfer-slot"
                  type="button"
                  layout
                  data-drop="transfer"
                  className={`transfer-slot ${focusTransfers && dragging ? 'target' : ''} ${hot === 'transfer' ? 'drop-hot' : ''}`}
                  aria-label="Перевести: положите карту того же достоинства"
                  onClick={useTransferSlot}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: hot === 'transfer' ? 1.06 : 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                >
                  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
                    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 5v14M5 12h14" />
                  </svg>
                  <span>Перевести</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {game.options.cheat && me !== game.defender && game.players[me]?.human && !game.taking && !game.over && view.table.some((p) => p.defense) && !accuseKnown() && (
            <span className="cheat-hint">Подозрительная карта? Нажмите на неё</span>
          )}

          <div className="discard-zone">
            <div className="discard">
              {game.discard.slice(-Math.max(PILE_SHOWN, game.discard.filter((c) => flights.has(c.id)).length)).map((c) => {
                const t = hashTilt(c.id)
                return <CardView key={c.id} card={c} faceUp={false} trump={game.trump} className="stacked" style={{ rotate: (t - 0.5) * 50, x: (t - 0.5) * 10, y: (0.5 - t) * 8 }} flight={flightOf(c.id)} />
              })}
            </div>
            {game.discard.length > 0 && <span className="zone-label">{game.discard.length}</span>}
          </div>

          <AnimatePresence>
            {banner && (
              <motion.div
                key={banner.key}
                className={`banner ${banner.tone}`}
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              >
                {banner.text}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        <section ref={meRef} className="me" aria-label="Ваши карты">
          <div ref={controlsRef} className="controls">
            {clock(me)}
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={status} className={`status ${actor === me ? 'yours' : ''}`} {...fade}>
                {status}
              </motion.p>
            </AnimatePresence>
            <div className="buttons">
              {onEmote && (
                <motion.button type="button" className="icon" aria-label="Смайлики" aria-expanded={emoteOpen} whileTap={{ scale: 0.9 }} onClick={() => setEmoteOpen((o) => !o)}>
                  <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
                    🙂
                  </span>
                </motion.button>
              )}
              <AnimatePresence>
                {staged.length > 0 && (
                  <motion.button key="cancel" type="button" className="icon cancel" aria-label="Вернуть карты в руку" whileTap={{ scale: 0.9 }} onClick={() => setPlan([])} {...pop}>
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path fill="currentColor" d="M6.3 6.3a1 1 0 0 1 1.4 0L12 10.6l4.3-4.3a1 1 0 1 1 1.4 1.4L13.4 12l4.3 4.3a1 1 0 0 1-1.4 1.4L12 13.4l-4.3 4.3a1 1 0 0 1-1.4-1.4l4.3-4.3-4.3-4.3a1 1 0 0 1 0-1.4z" />
                    </svg>
                  </motion.button>
                )}
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {main.onClick && (
                <motion.button
                  key="main"
                  {...pop}
                type="button"
                className={`main-action ${main.tone} ready`}
                whileTap={{ scale: 0.95 }}
                onClick={main.onClick}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={main.label} initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 34 }}>
                    {main.label}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
          <div
            className="hand"
            style={{ width: fanGeo.width, marginInline: fanGeo.pad, marginBottom: fanGeo.below }}
            onPointerDown={(e) => {
              const id = (e.target as HTMLElement).closest<HTMLElement>('[data-card]')?.dataset.card ?? null
              press.current = { x: e.clientX, y: e.clientY, id, mode: 'wait' }
              fanAt(e)
            }}
            onPointerMove={(e) => {
              const p = press.current
              if (dragging) return
              if (!p) {
                if (e.pointerType === 'mouse') fanAt(e)
                return
              }
              if (p.mode === 'wait') {
                const dx = Math.abs(e.clientX - p.x)
                const dy = p.y - e.clientY
                if (dx < 7 && Math.abs(dy) < 7) return
                if (dy > 0 && dy > dx * 0.8 && p.id && playable.has(p.id)) {
                  p.mode = 'drag'
                  slotControls.current.get(p.id)?.start(e.nativeEvent)
                } else p.mode = 'scrub'
              }
              if (p.mode === 'scrub') fanAt(e)
            }}
            onPointerUp={(e) => {
              press.current = null
              if (e.pointerType !== 'mouse') setFan(null)
            }}
            onPointerCancel={() => {
              press.current = null
              setFan(null)
            }}
            onPointerLeave={() => !press.current && setFan(null)}
          >
            {hand.map((c, i) => {
              const can = playable.has(c.id)
              const isSel = selected === c.id
              const isDrag = dragging === c.id
              const hint = defenseHint(view, c, can, me)
              return (
                // The slot only places the card in the hand; when its place changes the card glides there on its
                // own layout animation. What moves all the time under a pointer (the fan's push, lift and zoom)
                // happens on a layer inside the card, so it neither re-renders the table nor upsets the card's
                // measurements: transforms on the boxes around a card made flights in and out of the hand jump.
                <FanSlot key={`${c.id}:${resetKey}`} store={fanStore} index={i} left={i * handStep} lifted={isDrag}>
                <HandSlot
                  id={c.id}
                  registry={slotControls}
                  className={`hand-slot ${can ? 'can-drag' : ''}`}
                  drag={can}
                  dragSnapToOrigin={!(isDrag && hot)}
                  dragElastic={0.18}
                  dragMomentum={false}
                  whileDrag={{ scale: 1.08 }}
                  onDragStart={() => {
                    readZones()
                    // zones that appear once the drag has begun (the transfer slot) are read a moment later
                    setTimeout(readZones, 60)
                    setTimeout(readZones, 350)
                    setDragging(c.id)
                    setFan(null)
                    setSelected(null)
                    tap('light')
                  }}
                  onDrag={(_, info) => setHot(zoneAt(info))}
                  onDragEnd={(_, info) => {
                    lastDragEnd.current = Date.now()
                    const zone = zoneAt(info)
                    setDragging(null)
                    setHot(null)
                    if (zone) {
                      place(c.id, zone)
                      // a refused drop must not leave the card floating where it was released
                      setTimeout(() => {
                        if (handIds.current.includes(c.id)) setResetKey((k) => k + 1)
                      }, 80)
                    }
                  }}
                >
                  <CardView
                    card={c}
                    faceUp
                    trump={game.trump}
                    className={`${can ? 'playable' : actor === me ? 'dim' : ''} ${isSel ? 'selected' : ''} ${hint ? 'beats' : ''}`}
                    flight={flightOf(c.id)}
                    animate={{ rotate: isDrag ? 0 : fanGeo.angle(i), y: isDrag ? 0 : fanGeo.drop(i) + (isSel ? -hw * 0.2 : 0) }}
                    wrap={(inner) => (
                      <FanPose store={fanStore} index={i} still={isDrag} hw={hw} left={i * handStep} maxLeft={fanGeo.width - hw}>
                        {inner}
                      </FanPose>
                    )}
                    onClick={() => onCard(c)}
                    disabled={!can}
                  />
                </HandSlot>
                </FanSlot>
              )
            })}
          </div>
        </section>
      </LayoutGroup>

      <AnimatePresence>
        {liveEmote?.seat === me && (
          <motion.div key={liveEmote.key} className="my-emote" aria-hidden="true" initial={{ opacity: 0, y: 14, scale: 0.4 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -14, scale: 0.7 }} transition={{ type: 'spring', stiffness: 460, damping: 18 }}>
            {liveEmote.emoji}
          </motion.div>
        )}
        {emoteOpen && onEmote && (
          <motion.div key="emote-picker" className="emote-picker" role="menu" initial={{ opacity: 0, y: 8, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.92 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
            {EMOTES.map((e) => (
              <motion.button
                key={e}
                type="button"
                role="menuitem"
                aria-label={`Смайлик ${e}`}
                whileTap={{ scale: 0.8 }}
                whileHover={{ scale: 1.15 }}
                onClick={() => {
                  setEmoteOpen(false)
                  onEmote(e)
                }}
              >
                {e}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {game.over && (
          <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: 0.5 }}>
            <motion.div
              className="result"
              role="dialog"
              aria-modal="true"
              aria-labelledby="result-title"
              initial={{ y: 40, scale: 0.9, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 20, scale: 0.95, opacity: 0 }}
              transition={{ delay: 0.55, type: 'spring', stiffness: 320, damping: 26 }}
            >
              {game.loser !== me && <Confetti />}
              <Stagger delay={0.7}>
                <motion.div className="result-emblem" aria-hidden="true" initial={{ scale: 0, rotate: -40 }} animate={game.loser === me ? { scale: 1, rotate: [0, -14, 12, -8, 0] } : { scale: [0, 1.25, 1], rotate: 0 }} transition={game.loser === me ? { delay: 0.9, duration: 0.9 } : { delay: 0.8, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}>
                  {game.loser === null ? '🤝' : game.loser === me ? '🃏' : '🏆'}
                </motion.div>
                <p className="eyebrow">{series ? (seriesDone ? 'Турнир окончен' : `Партия ${series.played} из ${series.total}`) : 'Партия окончена'}</p>
                <h2 id="result-title">{seriesDone ? seriesTitle : resultTitle}</h2>
                <p className="result-sub">
                  {game.loser === null ? 'Последние карты ушли одновременно.' : game.loser === me ? 'Карты остались только у вас. Отыграйтесь.' : `Дураком остался ${game.players[game.loser].name}.`}
                </p>
                {payout && <Payout delta={payout.delta} balance={payout.balance} />}
                {series && (
                  <ul className="series-board" aria-label="Счёт турнира">
                    {game.players.map((p, i) => (
                      <li key={p.id} className={series.fools[i] === Math.max(...series.fools) && series.fools[i] > 0 ? 'last' : ''}>
                        <span>{p.name}</span>
                        <b>{series.fools[i]}</b>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="result-actions">
                  <motion.button type="button" className="ghost" whileTap={{ scale: 0.95 }} onClick={onExit}>
                    В меню
                  </motion.button>
                  {onPlayAgain ? (
                    <motion.button type="button" className="primary" whileTap={{ scale: 0.95 }} autoFocus onClick={onPlayAgain}>
                      {series ? (seriesDone ? 'Новый турнир' : 'Следующая партия') : 'Ещё партию'}
                    </motion.button>
                  ) : (
                    <span className="muted">Ждём, когда хозяин начнёт новую партию</span>
                  )}
                </div>
              </Stagger>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

const CONFETTI = ['#e3a94d', '#6bd49a', '#ff7a6b', '#7aa7ff', '#f0f0f0']

/** A short shower over the result dialog when the player did not lose. */
function Confetti() {
  return (
    <span className="confetti" aria-hidden="true">
      {Array.from({ length: 26 }, (_, i) => {
        const x = ((i * 37) % 100) - 50
        const drift = ((i * 53) % 60) - 30
        return (
          <motion.i
            key={i}
            style={{ left: `${50 + x}%`, background: CONFETTI[i % CONFETTI.length], width: 6 + (i % 3) * 2, height: 9 + (i % 4) * 2 }}
            initial={{ y: -20, opacity: 0, rotate: 0 }}
            animate={{ y: [0, 260 + (i % 5) * 40], x: [0, drift], opacity: [0, 1, 1, 0], rotate: 360 + i * 40 }}
            transition={{ delay: 0.75 + (i % 9) * 0.06, duration: 1.8 + (i % 4) * 0.25, ease: 'easeIn' }}
          />
        )
      })}
    </span>
  )
}

/** Reveals children one after another. */
export function Stagger({ children, delay = 0, step = 0.05 }: { children: ReactNode; delay?: number; step?: number }) {
  return (
    <>
      {(Array.isArray(children) ? children : [children]).map((child, i) => (
        <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay + i * step, type: 'spring', stiffness: 420, damping: 30 }}>
          {child}
        </motion.div>
      ))}
    </>
  )
}

/** A number that rolls up or down when it changes. */

type FanStore = ReturnType<typeof useFanStore>

/** The hand card under the pointer, kept out of React state so that sliding over the fan does not re-render the whole table. */
function useFanStore() {
  return useMemo(() => {
    let value: number | null = null
    const listeners = new Set<() => void>()
    return {
      get: () => value,
      set: (next: number | null) => {
        if (next === value) return
        value = next
        listeners.forEach((f) => f())
      },
      subscribe: (f: () => void) => {
        listeners.add(f)
        return () => {
          listeners.delete(f)
        }
      },
    }
  }, [])
}

/** A hand card's place in the fan; the card under the pointer is drawn on top. */
function FanSlot({ store, index, left, lifted, children }: { store: FanStore; index: number; left: number; lifted: boolean; children: ReactNode }) {
  const fan = useSyncExternalStore(store.subscribe, store.get)
  return (
    <div className="hand-pos" style={{ left, zIndex: lifted ? 200 : fan === index ? 100 : index + 1 }}>
      {children}
    </div>
  )
}

/** The face of a hand card rising under the pointer while its neighbours part. */
function FanPose({ store, index, still, hw, left, maxLeft, children }: { store: FanStore; index: number; still: boolean; hw: number; left: number; maxLeft: number; children: ReactNode }) {
  const fan = useSyncExternalStore(store.subscribe, store.get)
  const dist = fan === null || still ? 9 : Math.abs(index - fan)
  const k = Math.max(0, 1 - dist / 2.4)
  const part = fan === null || dist === 0 ? 0 : Math.sign(index - fan) * hw * 0.3 * Math.min(1, k * 1.7)
  // neighbours part inside the fan; the edge cards don't get shoved past its ends
  const push = Math.max(0, Math.min(maxLeft, left + part)) - left
  return (
    <motion.span className="pose" style={{ originY: 1 }} initial={false} animate={{ x: push, y: -hw * 0.3 * k, scale: 1 + 0.2 * k }} transition={FAN_SPRING}>
      {children}
    </motion.span>
  )
}

/** A hand card's drag box. The drag starts from the fan's own pointer logic, so a sideways slide can scrub the fan instead. */
function HandSlot({ id, registry, children, ...props }: { id: string; registry: { current: Map<string, DragControls> } } & React.ComponentProps<typeof motion.div>) {
  const controls = useDragControls()
  useEffect(() => {
    registry.current.set(id, controls)
    return () => {
      registry.current.delete(id)
    }
  }, [id, controls, registry])
  return (
    <motion.div data-card={id} dragControls={controls} dragListener={false} {...props}>
      {children}
    </motion.div>
  )
}

function planText(plan: Action[], g: GameState): string {
  const first = plan[0]
  if (first.type === 'transfer') return 'Перевести ход дальше?'
  return g.table.length ? 'Подтвердите' : ''
}

/** Who would defend after a transfer: the next player still in the game. */
function nextDefender(g: GameState): number | null {
  const n = g.players.length
  for (let k = 1; k < n; k++) {
    const i = (g.defender + k) % n
    if (!g.players[i].out) return i
  }
  return null
}

/** Marks cards that could cover an open attack, so defending is easy to read at a glance. */
function defenseHint(g: GameState, c: Card, playable: boolean, me: number) {
  if (!playable || g.defender !== me || g.taking) return false
  return g.table.some((p) => !p.defense && beats(c, p.attack, g.trump))
}

function statusText(g: GameState, actor: number | null, me: number): string {
  if (g.over) return 'Партия окончена'
  if (g.players[me].out) return 'Вы вышли из игры. Остальные доигрывают'
  if (actor === me) {
    const legal = legalActions(g, me)
    if (g.table.length === 0) return 'Ваш ход: выберите карту'
    if (g.defender === me && !g.taking) {
      if (!legal.some((a) => a.type === 'defend' || a.type === 'transfer')) return 'Отбиться нечем: берите'
      return legal.some((a) => a.type === 'transfer') ? 'Покройте, переведите или берите' : 'Покройте карты или берите'
    }
    const canAdd = legal.some((a) => a.type === 'attack')
    if (g.taking) return canAdd ? 'Можно подкинуть' : 'Подкинуть нечего'
    if (!canAdd) return 'Подкинуть нечего'
    return g.attacker === me ? 'Подкиньте или «Бито»' : 'Подкиньте или «Пас»'
  }
  // Throwing in doesn't wait for a turn: say so while the defender is still covering.
  if (actor !== null && actor !== me && legalActions(g, me).some((a) => a.type === 'attack')) return 'Можно подкинуть'
  // Whose turn it is already shows on the seats, so only the player's own moves need words.
  return ''
}
