import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { beats, Card, rankLabel, sortHand, SUIT_NAME } from '../engine/cards'
import { chooseAction } from '../engine/bot'
import { Action, applyAction, currentActor, GameState, HAND_SIZE, legalActions, maxPlayers, newGame } from '../engine/game'
import { CardView } from './CardView'
import { notify, syncStatusBar, tap } from './native'
import { SettingsPanel } from './SettingsPanel'
import { applyTheme, BOT_DELAY, loadSettings, loadStats, saveSettings, saveStats, Settings, Stats } from './settings'
import { SuitIcon } from './SuitIcon'

const ME = 0
const BOT_NAMES = ['Лиса', 'Мишка', 'Сова', 'Ёж', 'Волк']
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

function startGame(s: Settings): GameState {
  const players = Math.min(s.opponents + 1, maxPlayers(s.deckSize))
  return newGame({ players, deckSize: s.deckSize, mode: s.mode, names: ['Вы', ...BOT_NAMES], human: ME, seed: Date.now() })
}

/** Card width in px, tuned so six cards fit a phone and the table breathes on desktop. */
function useCardWidth() {
  const calc = () => Math.round(Math.max(54, Math.min(96, Math.min(window.innerWidth * 0.135, window.innerHeight * 0.105))))
  const [w, setW] = useState(calc)
  useEffect(() => {
    const on = () => setW(calc())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
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

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [stats, setStats] = useState<Stats>(loadStats)
  const [game, setGame] = useState<GameState>(() => startGame(loadSettings()))
  const [dealt, setDealt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [panel, setPanel] = useState<'settings' | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const cw = useCardWidth()
  const prev = useRef<GameState>(game)
  const counted = useRef<GameState | null>(null)

  useEffect(() => {
    applyTheme(settings.theme)
    syncStatusBar()
  }, [settings.theme])
  useEffect(() => saveSettings(settings), [settings])

  // Deal the opening hands one card at a time, round-robin, like a real dealer.
  const dealTotal = game.players.length * HAND_SIZE
  const dealing = dealt < dealTotal
  useEffect(() => {
    if (!dealing) return
    const t = setTimeout(() => setDealt((d) => d + 1), dealt === 0 ? 350 : DEAL_STEP_MS)
    return () => clearTimeout(t)
  }, [dealt, dealing])
  const undealt = useMemo(() => {
    if (!dealing) return [] as Card[]
    const n = game.players.length
    // Opening hands keep their deal order: hand[r] is the r-th card dealt to that player.
    // Listed last-dealt first, so the next card to deal sits on top of the deck.
    const hidden: Card[] = []
    for (let r = HAND_SIZE - 1; r >= 0; r--) for (let p = n - 1; p >= 0; p--) if (r * n + p >= dealt) hidden.push(game.players[p].hand[r])
    return hidden
  }, [dealing, dealt, game])
  const hiddenIds = useMemo(() => new Set(undealt.map((c) => c.id)), [undealt])

  const actor = dealing ? null : currentActor(game)
  const legal = useMemo(() => (dealing ? [] : legalActions(game, ME)), [game, dealing])
  const me = game.players[ME]
  const hand = useMemo(() => sortHand(me.hand, game.trump).filter((c) => !hiddenIds.has(c.id)), [me.hand, game.trump, hiddenIds])

  // Bots move on a timer so their plays can be followed.
  useEffect(() => {
    if (actor === null || actor === ME) return
    const t = setTimeout(() => {
      setGame((g) => (currentActor(g) === actor ? applyAction(g, actor, chooseAction(g, actor)) : g))
    }, BOT_DELAY[settings.speed])
    return () => clearTimeout(t)
  }, [game, actor, settings.speed])

  // Round results and notable moves become a short banner over the table.
  useEffect(() => {
    const before = prev.current
    prev.current = game
    if (before === game || before.options !== game.options) return
    const show = (text: string, tone: Banner['tone']) => setBanner({ key: Date.now(), text, tone })
    const a = game.lastAction
    if (a && a !== before.lastAction) {
      const who = game.players[a.player]
      if (a.action.type === 'transfer') show(a.player === ME ? 'Вы перевели' : `${who.name} переводит`, 'info')
      else if (a.action.type === 'take') show(a.player === ME ? 'Вы берёте' : `${who.name} берёт`, a.player === ME ? 'bad' : 'good')
    }
    if (before.table.length > 0 && game.table.length === 0 && game.lastRound?.end === 'beaten') show('Бито', 'info')
    if (currentActor(game) === ME && currentActor(before) !== ME) tap('light')
    setSelected(null)
  }, [game])

  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(null), 1300)
    return () => clearTimeout(t)
  }, [banner])

  // Record the result once per finished game.
  useEffect(() => {
    if (!game.over || counted.current === game) return
    counted.current = game
    notify(game.loser === ME ? 'warning' : 'success')
    setStats((s) => {
      const next = { ...s }
      if (game.loser === null) next.draws++
      else if (game.loser === ME) next.losses++
      else next.wins++
      saveStats(next)
      return next
    })
  }, [game])

  const play = (action: Action) => {
    setSelected(null)
    tap(action.type === 'take' ? 'medium' : 'light')
    setGame((g) => applyAction(g, ME, action))
  }

  const actionsFor = (cardId: string) => legal.filter((a) => 'cardId' in a && a.cardId === cardId)
  const playable = new Set(legal.flatMap((a) => ('cardId' in a ? [a.cardId] : [])))
  const selectedActions = selected ? actionsFor(selected) : []
  const targetPairs = new Set(selectedActions.flatMap((a) => (a.type === 'defend' ? [a.pair] : [])))
  const canTransferSelected = selectedActions.some((a) => a.type === 'transfer')

  const onCard = (card: Card) => {
    const options = actionsFor(card.id)
    if (options.length === 0) return
    if (options.length === 1) return play(options[0])
    tap('light')
    setSelected((s) => (s === card.id ? null : card.id))
  }

  const newRound = (s: Settings = settings) => {
    setSelected(null)
    setBanner(null)
    setDealt(0)
    setGame(startGame(s))
  }

  const take = legal.find((a) => a.type === 'take')
  const pass = legal.find((a) => a.type === 'pass')
  const passLabel = game.taking ? 'Пусть берёт' : ME === game.attacker ? 'Бито' : 'Пас'

  const opponents = game.players.filter((p) => p.id !== ME)
  const handStep = hand.length > 1 ? Math.min(cw * 0.94, (Math.min(window.innerWidth - 32, 780) - cw) / (hand.length - 1)) : 0
  const miniW = Math.round(cw * 0.4)
  const deckCards = [...game.deck.slice(1), ...undealt]
  const status = dealing ? 'Раздача…' : statusText(game, actor)

  return (
    <div className="app" style={{ ['--cw' as string]: `${cw}px`, ['--mini' as string]: `${miniW}px` }}>
      <motion.header className="bar" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="brand">
          <span className="logo">Дурак</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={`${game.options.mode}${game.options.deckSize}`} className="chip" {...fade}>
              {game.options.mode === 'podkidnoy' ? 'Подкидной' : 'Переводной'} · {game.options.deckSize}
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
          <motion.button type="button" className="ghost" whileTap={{ scale: 0.95 }} onClick={() => newRound()}>
            Новая игра
          </motion.button>
          <motion.button type="button" className="icon" aria-label="Настройки" whileTap={{ scale: 0.9, rotate: 30 }} whileHover={{ rotate: 15 }} onClick={() => setPanel('settings')}>
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
              return (
                <motion.div
                  key={`${game.options.seed}-${p.id}`}
                  layout="position"
                  className={`seat ${actor === p.id ? 'active' : ''} ${p.out ? 'out' : ''}`}
                  initial={{ opacity: 0, y: -14 }}
                  animate={{ opacity: p.out ? 0.45 : 1, y: 0 }}
                  exit={{ opacity: 0, y: -14 }}
                  transition={{ delay: idx * 0.06, type: 'spring', stiffness: 400, damping: 30 }}
                >
                  <div className="seat-head">
                    <motion.span className="avatar" animate={actor === p.id ? { scale: [1, 1.12, 1] } : { scale: 1 }} transition={actor === p.id ? { duration: 1.4, repeat: Infinity } : undefined}>
                      {p.name[0]}
                    </motion.span>
                    <span className="seat-name">{p.name}</span>
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
                    <motion.span key={role ?? 'wait'} className={`role ${role ? '' : 'empty'}`} {...fade}>
                      {role ?? 'Ждёт'}
                    </motion.span>
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </section>

        <motion.section className="felt" aria-label="Стол" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
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
                  {dealing ? 'Раздаём карты…' : actor === ME ? 'Ваш ход: положите карту' : `${game.players[game.attacker].name} ходит…`}
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
                  className={`pair ${target ? 'target' : ''}`}
                  onClick={defend}
                  role={target ? 'button' : undefined}
                  tabIndex={target ? 0 : undefined}
                  aria-label={target ? `Покрыть ${rankLabel(pair.attack.rank)} ${SUIT_NAME[pair.attack.suit]}` : undefined}
                  onKeyDown={defend ? (e) => (e.key === 'Enter' || e.key === ' ') && defend() : undefined}
                  animate={target ? { y: [0, -4, 0] } : { y: 0 }}
                  transition={target ? { duration: 1, repeat: Infinity, ease: 'easeInOut' } : { type: 'spring', stiffness: 400, damping: 30 }}
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
              <motion.p key={status} className={`status ${actor === ME ? 'yours' : ''}`} {...fade}>
                {status}
              </motion.p>
            </AnimatePresence>
            <motion.div className="buttons" layout>
              <AnimatePresence mode="popLayout">
                {canTransferSelected && selected && (
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
          <motion.div className="hand" animate={{ width: hand.length ? cw + handStep * (hand.length - 1) : cw }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
            {hand.map((c, i) => {
              const mid = (hand.length - 1) / 2
              const off = i - mid
              const can = playable.has(c.id)
              const isSel = selected === c.id
              const hint = defenseHint(game, c, can)
              return (
                <CardView
                  key={c.id}
                  card={c}
                  faceUp
                  trump={game.trump}
                  className={`${can ? 'playable' : actor === ME ? 'dim' : ''} ${isSel ? 'selected' : ''} ${hint ? 'beats' : ''}`}
                  style={{ left: i * handStep, zIndex: i + 1 }}
                  animate={{ rotate: off * Math.min(3, 14 / hand.length), y: Math.min(10, off * off * 0.7) + (isSel ? -cw * 0.22 : 0) }}
                  onClick={() => onCard(c)}
                  disabled={!can}
                />
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
                <h2 id="result-title">{game.loser === null ? 'Ничья' : game.loser === ME ? 'Вы дурак' : 'Вы не дурак'}</h2>
                <p className="result-sub">
                  {game.loser === null ? 'Последние карты ушли одновременно.' : game.loser === ME ? 'Карты остались только у вас. Отыграйтесь.' : `Дураком остался ${game.players[game.loser].name}.`}
                </p>
                <p className="result-stats">
                  Победы <b>{stats.wins}</b> · Поражения <b>{stats.losses}</b> · Ничьи <b>{stats.draws}</b>
                </p>
                <div className="result-actions">
                  <motion.button type="button" className="ghost" whileTap={{ scale: 0.95 }} onClick={() => setPanel('settings')}>
                    Настройки
                  </motion.button>
                  <motion.button type="button" className="primary" whileTap={{ scale: 0.95 }} autoFocus onClick={() => newRound()}>
                    Ещё партию
                  </motion.button>
                </div>
              </Stagger>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panel === 'settings' && (
          <SettingsPanel
            settings={settings}
            stats={stats}
            onClose={() => setPanel(null)}
            onChange={(s) => setSettings(s)}
            onStart={(s) => {
              setSettings(s)
              setPanel(null)
              newRound(s)
            }}
            onResetStats={() => {
              const zero = { wins: 0, losses: 0, draws: 0 }
              saveStats(zero)
              setStats(zero)
            }}
          />
        )}
      </AnimatePresence>
    </div>
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

/** Marks cards that could cover an open attack, so defending is easy to read at a glance. */
function defenseHint(g: GameState, c: Card, playable: boolean) {
  if (!playable || g.defender !== ME || g.taking) return false
  return g.table.some((p) => !p.defense && beats(c, p.attack, g.trump))
}

function statusText(g: GameState, actor: number | null): string {
  if (g.over) return 'Партия окончена'
  const me = g.players[ME]
  if (me.out) return 'Вы вышли из игры. Остальные доигрывают'
  if (actor === ME) {
    if (g.table.length === 0) return 'Ваш ход. Положите любую карту'
    if (g.defender === ME && !g.taking)
      return legalActions(g, ME).some((a) => a.type === 'transfer') ? 'Покройте, переведите или возьмите' : 'Покройте карты или возьмите'
    if (g.taking) return `${g.players[g.defender].name} берёт. Можно подкинуть`
    return g.attacker === ME ? 'Подкиньте карту или скажите «Бито»' : 'Подкиньте карту или пасуйте'
  }
  if (actor === null) return ''
  const who = g.players[actor].name
  if (g.table.length === 0) return `${who} ходит`
  if (actor === g.defender) return `${who} отбивается`
  return `${who} решает, подкинуть ли`
}
