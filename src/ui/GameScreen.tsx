import { AnimatePresence, LayoutGroup, motion, useDragControls, type DragControls, type PanInfo } from 'framer-motion'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { beats, Card, rankLabel, sortHand, SUIT_NAME } from '../engine/cards'
import { EMOTES, type Emote } from '../engine/emotes'
import type { Friends } from '../net/useFriends'
import { Action, canThrow, currentActor, GameState, HAND_SIZE, legalActions, previewAction } from '../engine/game'
import { CardView, type Flight } from './CardView'
import { notify, tap } from './native'
import { playCard, playDeal, playSweep } from './sfx'
import { BOT_NAMES } from './pickers'
import { AVATARS, type Stats } from './settings'
import { SuitIcon } from './SuitIcon'

const DEAL_STEP_MS = 75

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
  stats: Stats
  paused: boolean
  botDelay: number
  /** called when a bot should move; left out for guests, whose bots run on the host */
  onBotTurn?: (actor: number) => void
  onFinished: (result: Result, loser: number | null) => void
  series?: Series | null
  emote?: Emote | null
  /** online rooms: lets a player turn an opponent into a friend */
  friends?: Friends
  onEmote?: (emoji: string) => void
  onExit: () => void
  onOpenSettings: () => void
  /** left out when this player can't start the next game (an online guest) */
  onPlayAgain?: () => void
  room?: { code: string; notice: string | null; reconnecting?: boolean; roster?: { seat: number; name: string; fid?: string }[] }
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

/** Deals the opening hands one card at a time, round-robin, whenever a new game starts. */
function useDealing(game: GameState) {
  const seed = game.options.seed
  const total = game.players.length * HAND_SIZE
  const fresh = game.discard.length === 0 && game.table.length === 0 && !game.lastAction
  const [state, setState] = useState({ seed, dealt: fresh ? 0 : total })
  const dealt = state.seed === seed ? state.dealt : fresh ? 0 : total
  const dealing = dealt < total
  useEffect(() => {
    if (!dealing) return
    const t = setTimeout(() => setState({ seed, dealt: dealt + 1 }), dealt === 0 ? 450 : DEAL_STEP_MS)
    return () => clearTimeout(t)
  }, [dealt, dealing, seed])
  return { dealt, dealing }
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

export function GameScreen({ game, me, act, stats, paused, botDelay, onBotTurn, onFinished, series, emote, onEmote, friends, onExit, onOpenSettings, onPlayAgain, room }: Props) {
  const { table: cw, hand: hw, flat } = useCardSizes()
  const { dealt, dealing } = useDealing(game)
  const zones = useMemo(() => zoneMap(game), [game])
  const prevZones = useRef(zones)
  const prevSeed = useRef(game.options.seed)
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
  const [fan, setFan] = useState<number | null>(null)
  const slotControls = useRef(new Map<string, DragControls>())
  const press = useRef<{ x: number; y: number; id: string | null; mode: 'wait' | 'scrub' | 'drag' } | null>(null)
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
    if (dealing || prevSeed.current !== game.options.seed) return out
    const swept: string[] = []
    const taken: string[] = []
    const drawn: string[] = []
    for (const [id, zone] of zones) {
      const was = before.get(id)
      if (!was || was === zone) continue
      if (zone === 'discard') swept.push(id)
      else if (zone.startsWith('hand-') && was === 'deck') drawn.push(id)
      else if (zone.startsWith('hand-') && was === 'table') taken.push(id)
    }
    swept.forEach((id, i) => out.set(id, { kind: 'discard', delay: 0.35 + i * 0.07 }))
    taken.forEach((id, i) => out.set(id, { kind: 'take', delay: 0.3 + i * 0.05 }))
    const start = swept.length || taken.length ? 0.3 + (swept.length + taken.length) * 0.07 + 0.55 : 0.25
    drawn.forEach((id, i) => out.set(id, { kind: 'draw', delay: start + i * 0.1 }))
    return out
  }, [zones, dealing, game.options.seed])
  useEffect(() => {
    prevZones.current = zones
    prevSeed.current = game.options.seed
  }, [zones, game.options.seed])

  // Sounds follow the flights: one shuffle for a sweep, one flick per card dealt.
  useEffect(() => {
    if (flights.size === 0) return
    const list = [...flights.values()]
    const sweep = list.filter((f) => f.kind !== 'draw')
    if (sweep.length) playSweep(Math.min(...sweep.map((f) => f.delay)), sweep.length)
    list
      .filter((f) => f.kind === 'draw')
      .slice(0, 10)
      .forEach((f) => playDeal(f.delay))
  }, [flights])
  useEffect(() => {
    if (dealing && dealt > 0) playDeal()
  }, [dealt, dealing])

  const actor = dealing ? null : currentActor(game)
  const legal = useMemo(() => (dealing ? [] : legalActions(game, me)), [game, dealing, me])

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
  const throwIds = staged[0]?.type === 'throw' ? staged[0].cardIds : []
  const thrower = legal.some((a) => a.type === 'attack')
  const viewLegal = useMemo(() => (dealing || !preview ? legal : legalActions(view, me)), [dealing, preview, legal, view, me])

  const mine = view.players[me]
  const hand = useMemo(() => sortHand(mine.hand, game.trump).filter((c) => !hiddenIds.has(c.id)), [mine.hand, game.trump, hiddenIds])

  // Bots "think" before each move, longer when there is more on the table, so their plays can be followed.
  const botThinking = actor !== null && !game.players[actor].human && !game.over
  useEffect(() => {
    if (actor === null || !onBotTurn || paused || game.players[actor].human) return
    const weight = 0.75 + Math.random() * 0.5 + Math.min(game.table.length, 4) * 0.08
    const t = setTimeout(() => onBotTurn(actor), Math.round(botDelay * weight))
    return () => clearTimeout(t)
  }, [game, actor, paused, botDelay, onBotTurn])

  // Round results and notable moves become a short banner over the table.
  useEffect(() => {
    const before = prev.current
    prev.current = game
    if (before === game || before.options.seed !== game.options.seed) return
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
    if (!game.over || counted.current === game.options.seed) return
    counted.current = game.options.seed ?? 0
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
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  // A lead or throw-in goes out by itself once no more cards are added.
  const autoThrow = staged[0]?.type === 'throw'
  useEffect(() => {
    if (!autoThrow || dragging) return
    const t = setTimeout(() => confirmRef.current(), 2200)
    return () => clearTimeout(t)
  }, [plan, autoThrow, dragging])

  const transferSeat = nextDefender(game)
  const optionsFor = (cardId: string) => viewLegal.filter((a) => 'cardId' in a && a.cardId === cardId)
  const throwWith = (cardId: string): string[] | null => {
    if (!thrower || staged.some((a) => a.type !== 'throw')) return null
    const more = [...throwIds, cardId]
    if (canThrow(game, me, more)) return more
    return canThrow(game, me, [cardId]) ? [cardId] : null
  }
  const canStage = (cardId: string) => !!throwWith(cardId) || optionsFor(cardId).length > 0

  const stage = (move: Action) => {
    // Covering is played straight away; leading and throwing in wait a moment for more cards of the same rank.
    if (move.type === 'defend') return play(move)
    tap('light')
    setSelected(null)
    if (move.type === 'throw') playCard()
    setPlan(move.type === 'throw' ? [move] : [...staged, move])
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
    const first = staged[0]
    if (first?.type === 'throw') {
      const rest = first.cardIds.filter((id) => id !== cardId)
      setPlan(rest.length && canThrow(game, me, rest) ? [{ type: 'throw', cardIds: rest }] : [])
      return
    }
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
      : autoThrow
        ? { label: 'Кладём…', tone: 'primary' }
        : take && myTurn
          ? { label: 'Беру', tone: 'danger', onClick: () => play(take) }
          : pass && myTurn
            ? { label: passLabel, tone: 'primary', onClick: () => play(pass) }
            : { label: myTurn ? 'Ваш ход' : game.over ? 'Конец' : 'Ждём', tone: 'primary' }

  const n = game.players.length
  const opponents = Array.from({ length: n - 1 }, (_, k) => game.players[(me + 1 + k) % n])
  const handStep = hand.length > 1 ? Math.min(hw * 0.92, (Math.min(window.innerWidth - 32 - (flat ? 240 : 0), 860) - hw) / (hand.length - 1)) : 0
  handIds.current = hand.map((c) => c.id)
  const fanAt = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (hand.length === 0) return
    const i = hand.length > 1 ? Math.round((e.clientX - r.left - hw / 2) / handStep) : 0
    setFan(Math.max(0, Math.min(hand.length - 1, i)))
  }
  const miniW = Math.round(cw * 0.42)
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
        <div className="brand">
          <motion.button type="button" className="icon" aria-label="Главное меню" whileTap={{ scale: 0.9 }} whileHover={{ x: -2 }} onClick={onExit}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="currentColor" d="M14.7 5.3a1 1 0 0 1 0 1.4L9.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z" />
            </svg>
          </motion.button>
          <span className="logo">Дурак</span>
          <span className="chips" title={`${game.options.deckSize} карт${room ? `, комната ${room.code}` : ''}`}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={game.options.mode} className="chip" {...fade}>
                {game.options.mode === 'podkidnoy' ? 'Подкидной' : 'Переводной'}
              </motion.span>
            </AnimatePresence>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={game.options.cheat ? 'cheat' : 'classic'} className={`chip ${game.options.cheat ? 'warn' : ''}`} {...fade}>
                {game.options.cheat ? 'Шулер' : 'Классика'}
              </motion.span>
            </AnimatePresence>
          </span>
        </div>
        <div className="bar-actions">
          <span className="score" title="Победы · поражения · ничьи">
            <Counter value={stats.wins} />
            <i>·</i>
            <Counter value={stats.losses} />
            <i>·</i>
            <Counter value={stats.draws} />
          </span>
          <motion.button type="button" className="icon" aria-label="Настройки" whileTap={{ scale: 0.9, rotate: 30 }} whileHover={{ rotate: 15 }} onClick={onOpenSettings}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M4 7h10.2a3 3 0 0 1 5.6 0H20a1 1 0 1 1 0 2h-.2a3 3 0 0 1-5.6 0H4a1 1 0 0 1 0-2zm13 2a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM4 15h.2a3 3 0 0 1 5.6 0H20a1 1 0 1 1 0 2H9.8a3 3 0 0 1-5.6 0H4a1 1 0 1 1 0-2zm3 2a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"
              />
            </svg>
          </motion.button>
        </div>
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
        <section className="opponents" aria-label="Соперники">
          <AnimatePresence initial>
            {opponents.map((p, idx) => {
              const cards = p.hand.filter((c) => !hiddenIds.has(c.id))
              const step = cards.length > 1 ? Math.min(miniW * 0.42, (miniW * 2.6 - miniW) / (cards.length - 1)) : 0
              const role = p.out ? 'Вышел' : dealing ? null : p.id === game.defender ? (game.taking ? 'Берёт' : 'Отбивается') : p.id === game.attacker ? 'Ходит' : null
              const isTransferTarget = dragging !== null && focusTransfers && transferSeat === p.id
              return (
                <motion.div
                  key={`${game.options.seed}-${p.id}`}
                  layout="position"
                  data-drop={`seat-${p.id}`}
                  className={`seat ${actor === p.id ? 'active' : ''} ${p.out ? 'out' : ''} ${isTransferTarget ? 'drop-ok' : ''} ${isTransferTarget && hot === `seat-${p.id}` ? 'drop-hot' : ''}`}
                  initial={{ opacity: 0, y: -14 }}
                  animate={{ opacity: p.out ? 0.45 : 1, y: 0 }}
                  exit={{ opacity: 0, y: -14 }}
                  transition={{ delay: idx * 0.06, type: 'spring', stiffness: 400, damping: 30 }}
                >
                  <div className="seat-head">
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
                  <motion.div className="mini-hand" animate={{ width: miniW + step * Math.max(0, cards.length - 1) }} transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
                    {cards.map((c, i) => (
                      <CardView key={c.id} card={c} faceUp={false} trump={game.trump} size="mini" style={{ left: i * step }} flight={flights.get(c.id)} />
                    ))}
                  </motion.div>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span key={isTransferTarget ? 'transfer' : role ?? 'wait'} className={`role ${role || isTransferTarget ? '' : 'empty'}`} {...fade}>
                      {isTransferTarget ? 'Перевести сюда' : role ?? 'Ждёт'}
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
                <b>{deckCards.length + 1} в колоде</b>
              </span>
            )}
          </div>

          <div className="battle">
            <AnimatePresence>
              {view.table.length === 0 && !game.over && dealing && (
                <motion.span key="hint" className="empty-hint" {...fade}>
                  Раздаём карты…
                </motion.span>
              )}
            </AnimatePresence>
            {view.table.map((pair, i) => {
              const target = targetPairs.has(i)
              const attackPending = pending.has(pair.attack.id)
              const coverPending = !!pair.defense && pending.has(pair.defense.id)
              // Cheater mode: tapping a cover someone else laid down says "that's a trick".
              const accusable = !!game.options.cheat && !!pair.defense && me !== game.defender && game.players[me]?.human && !game.over && !game.taking && !coverPending
              const onPair = target && selected ? () => place(selected, `pair-${i}`) : attackPending ? () => unstage(pair.attack.id) : coverPending ? () => unstage(pair.defense!.id) : accusable ? () => play({ type: 'accuse', pair: i }) : undefined
              return (
                <motion.div
                  key={pair.attack.id}
                  layout
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
                  <CardView card={pair.attack} faceUp trump={game.trump} className={attackPending ? 'pending' : ''} />
                  {pair.defense && <CardView card={pair.defense} faceUp trump={game.trump} className={`cover ${coverPending ? 'pending' : ''}`} style={{ rotate: 7 }} />}
                </motion.div>
              )
            })}
            <AnimatePresence>
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

          {game.options.cheat && me !== game.defender && game.players[me]?.human && !game.taking && !game.over && view.table.some((p) => p.defense) && (
            <span className="cheat-hint">Подозрительная карта? Нажмите на неё</span>
          )}

          <div className="discard-zone">
            <div className="discard">
              {game.discard.slice(-PILE_SHOWN).map((c) => {
                const t = hashTilt(c.id)
                return <CardView key={c.id} card={c} faceUp={false} trump={game.trump} className="stacked" style={{ rotate: (t - 0.5) * 50, x: (t - 0.5) * 10, y: (0.5 - t) * 8 }} flight={flights.get(c.id)} />
              })}
            </div>
            <span className="zone-label">{game.discard.length ? `Бито: ${game.discard.length}` : 'Бито'}</span>
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

        <section className="me" aria-label="Ваши карты">
          <div className="controls">
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
                {(main.onClick || autoThrow) && (
                <motion.button
                  key="main"
                  {...pop}
                type="button"
                className={`main-action ${main.tone} ${main.onClick ? 'ready' : ''}`}
                disabled={!main.onClick}
                whileTap={main.onClick ? { scale: 0.95 } : undefined}
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
            style={{ width: hand.length ? hw + handStep * (hand.length - 1) : hw }}
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
              const mid = (hand.length - 1) / 2
              const off = i - mid
              const can = playable.has(c.id)
              const isSel = selected === c.id
              const isDrag = dragging === c.id
              const hint = defenseHint(view, c, can, me)
              const dist = fan === null || isDrag ? 9 : Math.abs(i - fan)
              const k = Math.max(0, 1 - dist / 2.4)
              const push = fan === null || dist === 0 ? 0 : Math.sign(i - fan) * hw * 0.3 * Math.min(1, k * 1.7)
              return (
                // The outer box slides the card along the hand with a transform (cheap), the inner one is dragged.
                <motion.div
                  key={`${c.id}:${resetKey}`}
                  className="hand-pos"
                  style={{ zIndex: isDrag ? 200 : fan === i ? 100 : i + 1, transformOrigin: '50% 100%' }}
                  initial={false}
                  animate={{ x: i * handStep + push, y: -hw * 0.3 * k, scale: 1 + 0.2 * k }}
                  transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                >
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
                    flight={flights.get(c.id)}
                    animate={{ rotate: isDrag ? 0 : off * Math.min(3, 14 / hand.length), y: isDrag ? 0 : Math.min(10, off * off * 0.7) + (isSel ? -hw * 0.2 : 0) }}
                    onClick={() => onCard(c)}
                    disabled={!can}
                  />
                </HandSlot>
                </motion.div>
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
                <p className="result-stats">
                  Победы <b>{stats.wins}</b> · Поражения <b>{stats.losses}</b> · Ничьи <b>{stats.draws}</b>
                </p>
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
function Counter({ value }: { value: number }) {
  return (
    <span className="counter">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.b key={value} initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
          {value}
        </motion.b>
      </AnimatePresence>
    </span>
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
  if (first.type === 'throw') return 'Можно добавить ещё карты'
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
  // Whose turn it is already shows on the seats, so only the player's own moves need words.
  return ''
}
