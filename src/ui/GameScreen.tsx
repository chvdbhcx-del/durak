import { AnimatePresence, LayoutGroup, motion, type PanInfo } from 'framer-motion'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { beats, Card, rankLabel, sortHand, SUIT_NAME } from '../engine/cards'
import { Action, currentActor, GameState, HAND_SIZE, legalActions } from '../engine/game'
import { CardView } from './CardView'
import { notify, tap } from './native'
import type { Stats } from './settings'
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

interface Props {
  game: GameState
  me: number
  act: (action: Action) => void
  stats: Stats
  paused: boolean
  botDelay: number
  /** called when a bot should move; left out for guests, whose bots run on the host */
  onBotTurn?: (actor: number) => void
  onFinished: (result: Result) => void
  onExit: () => void
  onOpenSettings: () => void
  /** left out when this player can't start the next game (an online guest) */
  onPlayAgain?: () => void
  room?: { code: string; notice: string | null }
}

/** Card sizes in px: table cards and the bigger cards in your own hand. */
function useCardSizes() {
  const calc = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    const table = Math.round(Math.max(62, Math.min(118, Math.min(w * 0.2, h * 0.118))))
    const hand = Math.round(Math.max(76, Math.min(132, Math.min(w * 0.25, h * 0.14))))
    return { table, hand }
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

export function GameScreen({ game, me, act, stats, paused, botDelay, onBotTurn, onFinished, onExit, onOpenSettings, onPlayAgain, room }: Props) {
  const { table: cw, hand: hw } = useCardSizes()
  const { dealt, dealing } = useDealing(game)
  const [selected, setSelected] = useState<string | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [hot, setHot] = useState<string | null>(null)
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

  const actor = dealing ? null : currentActor(game)
  const legal = useMemo(() => (dealing ? [] : legalActions(game, me)), [game, dealing, me])
  const mine = game.players[me]
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
    const a = game.lastAction
    if (a && JSON.stringify(a) !== JSON.stringify(before.lastAction)) {
      const who = game.players[a.player]
      if (a.action.type === 'transfer') show(a.player === me ? 'Вы перевели' : `${who.name} переводит`, 'info')
      else if (a.action.type === 'take') show(a.player === me ? 'Вы берёте' : `${who.name} берёт`, a.player === me ? 'bad' : 'good')
    }
    if (before.table.length > 0 && game.table.length === 0 && game.lastRound?.end === 'beaten') show('Бито', 'info')
    if (currentActor(game) === me && currentActor(before) !== me) tap('light')
    setSelected(null)
  }, [game, me])

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
    onFinished(result)
  }, [game, me, onFinished])

  const play = (action: Action) => {
    setSelected(null)
    tap(action.type === 'take' ? 'medium' : 'light')
    act(action)
  }

  const actionsFor = (cardId: string) => legal.filter((a) => 'cardId' in a && a.cardId === cardId)
  const playable = new Set(legal.flatMap((a) => ('cardId' in a ? [a.cardId] : [])))
  const focus = dragging ?? selected
  const focusActions = focus ? actionsFor(focus) : []
  const targetPairs = new Set(focusActions.flatMap((a) => (a.type === 'defend' ? [a.pair] : [])))
  const canTransferFocus = focusActions.some((a) => a.type === 'transfer')
  const tableTarget = !!dragging && focusActions.some((a) => a.type === 'attack' || a.type === 'transfer')
  const transferSeat = canTransferFocus ? nextDefender(game) : null

  const onCard = (card: Card) => {
    if (Date.now() - lastDragEnd.current < 300) return
    const options = actionsFor(card.id)
    if (options.length === 0) return
    if (options.length === 1) return play(options[0])
    tap('light')
    setSelected((s) => (s === card.id ? null : card.id))
  }

  // Drag and drop: the drop zone under the finger decides the move.
  const zoneAt = (info: PanInfo) => {
    for (const el of document.elementsFromPoint(info.point.x - window.scrollX, info.point.y - window.scrollY)) {
      const zone = (el as HTMLElement).closest?.('[data-drop]') as HTMLElement | null
      if (zone && !zone.closest('.hand')) return zone.dataset.drop ?? null
    }
    return null
  }

  const actionForDrop = (cardId: string, zone: string | null): Action | null => {
    if (!zone) return null
    const options = actionsFor(cardId)
    if (zone.startsWith('pair-')) {
      const pair = Number(zone.slice(5))
      return options.find((a) => a.type === 'defend' && a.pair === pair) ?? null
    }
    const transfer = options.find((a) => a.type === 'transfer')
    if (transfer && (zone === 'table' || zone === `seat-${transferSeat}`)) return transfer
    if (zone === 'table') {
      const attack = options.find((a) => a.type === 'attack')
      if (attack) return attack
      // Dropped on the cloth while defending a single open card: cover that one.
      const defends = options.filter((a) => a.type === 'defend')
      if (defends.length === 1) return defends[0]
    }
    return null
  }

  const take = legal.find((a) => a.type === 'take')
  const pass = legal.find((a) => a.type === 'pass')
  const passLabel = game.taking ? 'Пусть берёт' : me === game.attacker ? 'Бито' : 'Пас'

  const n = game.players.length
  const opponents = Array.from({ length: n - 1 }, (_, k) => game.players[(me + 1 + k) % n])
  const handStep = hand.length > 1 ? Math.min(hw * 0.92, (Math.min(window.innerWidth - 32, 860) - hw) / (hand.length - 1)) : 0
  const miniW = Math.round(cw * 0.42)
  const deckCards = [...game.deck.slice(1), ...undealt]
  const status = dealing ? 'Раздача…' : statusText(game, actor, me)
  const resultTitle = game.loser === null ? 'Ничья' : game.loser === me ? 'Вы дурак' : 'Вы не дурак'

  return (
    <motion.div
      className={`app ${dragging ? 'is-dragging' : ''}`}
      style={{ ['--cw' as string]: `${cw}px`, ['--hw' as string]: `${hw}px`, ['--mini' as string]: `${miniW}px` }}
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
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={`${game.options.mode}${game.options.deckSize}${room?.code}`} className="chip" {...fade}>
              {room ? `Комната ${room.code}` : `${game.options.mode === 'podkidnoy' ? 'Подкидной' : 'Переводной'} · ${game.options.deckSize}`}
            </motion.span>
          </AnimatePresence>
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

      <LayoutGroup>
        <section className="opponents" aria-label="Соперники">
          <AnimatePresence initial>
            {opponents.map((p, idx) => {
              const cards = p.hand.filter((c) => !hiddenIds.has(c.id))
              const step = cards.length > 1 ? Math.min(miniW * 0.42, (miniW * 2.6 - miniW) / (cards.length - 1)) : 0
              const role = p.out ? 'Вышел' : dealing ? null : p.id === game.defender ? (game.taking ? 'Берёт' : 'Отбивается') : p.id === game.attacker ? 'Ходит' : null
              const isTransferTarget = dragging !== null && transferSeat === p.id
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
                    <motion.span className={`avatar ${p.human && room ? 'person' : ''}`} animate={actor === p.id ? { scale: [1, 1.12, 1] } : { scale: 1 }} transition={actor === p.id ? { duration: 1.4, repeat: Infinity } : undefined}>
                      {p.name[0]}
                    </motion.span>
                    <span className="seat-name">{p.name}</span>
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
                      <CardView key={c.id} card={c} faceUp={false} trump={game.trump} size="mini" style={{ left: i * step }} />
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
              {deckCards.map((c, i) => (
                <CardView key={c.id} card={c} faceUp={false} trump={game.trump} className="stacked" style={{ x: -Math.min(i, 8) * 0.6, y: -Math.min(i, 8) * 0.6 }} />
              ))}
              <AnimatePresence>
                {game.deck.length === 0 && !dealing && (
                  <motion.span className="trump-ghost" aria-label={`Козырь: ${SUIT_NAME[game.trump]}`} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 0.35, scale: 1 }} exit={{ opacity: 0 }}>
                    <SuitIcon suit={game.trump} size="100%" />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <span className="zone-label">
              {game.deck.length > 0 ? `${deckCards.length + 1} в колоде` : 'Колода пуста'} · козырь {SUIT_NAME[game.trump]}
            </span>
          </div>

          <motion.div className="battle" layout>
            <AnimatePresence>
              {game.table.length === 0 && !game.over && (
                <motion.span key="hint" className="empty-hint" {...fade}>
                  {dealing ? 'Раздаём карты…' : actor === me ? 'Ваш ход: перетащите карту сюда' : `${game.players[game.attacker].name} ходит…`}
                </motion.span>
              )}
            </AnimatePresence>
            {game.table.map((pair, i) => {
              const target = targetPairs.has(i)
              const defend = target && selected ? () => play({ type: 'defend', cardId: selected, pair: i }) : undefined
              return (
                <motion.div
                  key={pair.attack.id}
                  layout
                  data-drop={`pair-${i}`}
                  className={`pair ${target ? 'target' : ''} ${target && hot === `pair-${i}` ? 'drop-hot' : ''}`}
                  onClick={defend}
                  role={defend ? 'button' : undefined}
                  tabIndex={defend ? 0 : undefined}
                  aria-label={defend ? `Покрыть ${rankLabel(pair.attack.rank)} ${SUIT_NAME[pair.attack.suit]}` : undefined}
                  onKeyDown={defend ? (e) => (e.key === 'Enter' || e.key === ' ') && defend() : undefined}
                  animate={target && !dragging ? { y: [0, -4, 0] } : { y: 0, scale: target && hot === `pair-${i}` ? 1.06 : 1 }}
                  transition={target && !dragging ? { duration: 1, repeat: Infinity, ease: 'easeInOut' } : { type: 'spring', stiffness: 400, damping: 30 }}
                >
                  <CardView card={pair.attack} faceUp trump={game.trump} />
                  {pair.defense && <CardView card={pair.defense} faceUp trump={game.trump} className="cover" style={{ rotate: 7 }} />}
                </motion.div>
              )
            })}
          </motion.div>

          <div className="discard-zone">
            <div className="discard">
              {game.discard.map((c) => {
                const t = hashTilt(c.id)
                return <CardView key={c.id} card={c} faceUp={false} trump={game.trump} className="stacked" style={{ rotate: (t - 0.5) * 50, x: (t - 0.5) * 10, y: (0.5 - t) * 8 }} />
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
            <motion.div className="buttons" layout>
              <AnimatePresence mode="popLayout">
                {canTransferFocus && selected && !dragging && (
                  <motion.button key="transfer" layout type="button" className="primary" whileTap={{ scale: 0.94 }} onClick={() => play({ type: 'transfer', cardId: selected })} {...pop}>
                    Перевести
                  </motion.button>
                )}
                {take && (
                  <motion.button key="take" layout type="button" className="danger" whileTap={{ scale: 0.94 }} onClick={() => play(take)} {...pop}>
                    Беру
                  </motion.button>
                )}
                {pass && (
                  <motion.button key={`pass-${passLabel}`} layout type="button" className="primary" whileTap={{ scale: 0.94 }} onClick={() => play(pass)} {...pop}>
                    {passLabel}
                  </motion.button>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
          <motion.div className="hand" animate={{ width: hand.length ? hw + handStep * (hand.length - 1) : hw }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
            {hand.map((c, i) => {
              const mid = (hand.length - 1) / 2
              const off = i - mid
              const can = playable.has(c.id)
              const isSel = selected === c.id
              const isDrag = dragging === c.id
              const hint = defenseHint(game, c, can, me)
              return (
                <motion.div
                  key={c.id}
                  className={`hand-slot ${can ? 'can-drag' : ''}`}
                  style={{ left: i * handStep, zIndex: isDrag ? 200 : i + 1 }}
                  drag={can}
                  dragSnapToOrigin
                  dragElastic={0.18}
                  dragMomentum={false}
                  whileDrag={{ scale: 1.08 }}
                  onDragStart={() => {
                    setDragging(c.id)
                    setSelected(null)
                    tap('light')
                  }}
                  onDrag={(_, info) => setHot(zoneAt(info))}
                  onDragEnd={(_, info) => {
                    lastDragEnd.current = Date.now()
                    const action = actionForDrop(c.id, zoneAt(info))
                    setDragging(null)
                    setHot(null)
                    if (action) play(action)
                  }}
                >
                  <CardView
                    card={c}
                    faceUp
                    trump={game.trump}
                    className={`${can ? 'playable' : actor === me ? 'dim' : ''} ${isSel ? 'selected' : ''} ${hint ? 'beats' : ''}`}
                    animate={{ rotate: isDrag ? 0 : off * Math.min(3, 14 / hand.length), y: isDrag ? 0 : Math.min(10, off * off * 0.7) + (isSel ? -hw * 0.2 : 0) }}
                    onClick={() => onCard(c)}
                    disabled={!can}
                  />
                </motion.div>
              )
            })}
          </motion.div>
        </section>
      </LayoutGroup>

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
              <Stagger delay={0.7}>
                <p className="eyebrow">Партия окончена</p>
                <h2 id="result-title">{resultTitle}</h2>
                <p className="result-sub">
                  {game.loser === null ? 'Последние карты ушли одновременно.' : game.loser === me ? 'Карты остались только у вас. Отыграйтесь.' : `Дураком остался ${game.players[game.loser].name}.`}
                </p>
                <p className="result-stats">
                  Победы <b>{stats.wins}</b> · Поражения <b>{stats.losses}</b> · Ничьи <b>{stats.draws}</b>
                </p>
                <div className="result-actions">
                  <motion.button type="button" className="ghost" whileTap={{ scale: 0.95 }} onClick={onExit}>
                    В меню
                  </motion.button>
                  {onPlayAgain ? (
                    <motion.button type="button" className="primary" whileTap={{ scale: 0.95 }} autoFocus onClick={onPlayAgain}>
                      Ещё партию
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
    if (g.table.length === 0) return 'Ваш ход. Перетащите или нажмите карту'
    if (g.defender === me && !g.taking)
      return legalActions(g, me).some((a) => a.type === 'transfer') ? 'Покройте, переведите или возьмите' : 'Покройте карты или возьмите'
    if (g.taking) return `${g.players[g.defender].name} берёт. Можно подкинуть`
    return g.attacker === me ? 'Подкиньте карту или скажите «Бито»' : 'Подкиньте карту или пасуйте'
  }
  if (actor === null) return ''
  const who = g.players[actor].name
  if (g.table.length === 0) return `${who} ходит`
  if (actor === g.defender) return `${who} отбивается`
  return `${who} решает, подкинуть ли`
}
