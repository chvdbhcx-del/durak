import { m, type MotionStyle, type TargetAndTransition } from 'framer-motion'
import { useEffect, useState, useSyncExternalStore, type MouseEventHandler, type ReactNode } from 'react'
import { Card, isRed, rankLabel, Suit, SUIT_NAME } from '../engine/cards'
import { getCardFace, watchCardFace } from './settings'
import { SuitIcon } from './SuitIcon'

interface Props {
  card: Card
  faceUp: boolean
  trump: Suit
  size?: 'full' | 'mini'
  className?: string
  style?: MotionStyle
  animate?: TargetAndTransition
  onClick?: MouseEventHandler
  disabled?: boolean
  label?: string
  /** a slow, staggered flight, used when cards are dealt out of the deck or swept away */
  flight?: Flight
  /** wraps the card's face in a layer of its own, e.g. the hand fan's lift; the card's box itself stays put */
  wrap?: (face: ReactNode) => ReactNode
}

export interface Flight {
  delay: number
  kind: 'draw' | 'discard' | 'take' | 'play'
}

// Cards glide on eased curves instead of springs: a gentle start and a long soft landing, no overshoot.
export const cardSpring = { type: 'tween', ease: [0.22, 1, 0.36, 1], duration: 0.5 } as const
// Flights between zones are slower still, each with an ease-in-out that picks the card up softly and sets it down softly.
const FLIGHT: Record<Flight['kind'], { ease: [number, number, number, number]; duration: number }> = {
  // out of the deck into a hand
  draw: { ease: [0.3, 0.1, 0.2, 1], duration: 0.95 },
  // out of another player's fan onto the table: a lead, a cover or a throw-in
  play: { ease: [0.35, 0, 0.2, 1], duration: 0.8 },
  // from the table into the hand of the player who takes
  take: { ease: [0.42, 0, 0.2, 1], duration: 1.15 },
  // the sweep into the discard pile is the slowest and softest: the cards lift, glide, and settle
  discard: { ease: [0.45, 0, 0.18, 1], duration: 1.4 },
}

/** When a flight lands, in seconds from the moment it was set off. */
export function flightEnd(f: Flight): number {
  return f.delay + FLIGHT[f.kind].duration
}
const flipSpring = { type: 'spring', stiffness: 200, damping: 26 } as const

/**
 * A card keeps its layoutId while it moves between deck, hands, table and discard, so the
 * component remounts in each new spot. Remembering which side was last shown lets the
 * new instance start from that side and flip over during the flight.
 */
const lastFace = new Map<string, boolean>()

export function CardView({ card, faceUp, trump, size = 'full', className = '', style, animate, onClick, disabled, label, flight, wrap }: Props) {
  const transition = flight ? { type: 'tween' as const, ...FLIGHT[flight.kind], delay: flight.delay } : cardSpring
  const name = `${rankLabel(card.rank)} ${SUIT_NAME[card.suit]}`
  const was = lastFace.get(card.id) ?? faceUp
  useEffect(() => {
    lastFace.set(card.id, faceUp)
  }, [card.id, faceUp])

  // A card is only built in 3D while it turns over. A resting card shows one flat side: the 3D
  // flipper costs the browser several GPU layers per card, and a table full of them stutters.
  const [turn, setTurn] = useState<{ face: boolean; from: boolean | null }>(() => ({ face: faceUp, from: was !== faceUp ? was : null }))
  let from = turn.from
  if (turn.face !== faceUp) {
    from = turn.face
    setTurn({ face: faceUp, from })
  }
  const turning = from !== null

  const faceStyle = useSyncExternalStore(watchCardFace, getCardFace)
  const front =
    faceStyle === 'classic' && card.rank > 0 ? (
      <ClassicFace card={card} trump={trump} />
    ) : (
      <span className={`side front ${isRed(card.suit) ? 'red' : ''} ${card.suit === trump ? 'trump' : ''}`}>
        <span className="corner tl">
          <b>{rankLabel(card.rank)}</b>
          <SuitIcon suit={card.suit} />
        </span>
        <span className="pip">
          <SuitIcon suit={card.suit} size="100%" />
        </span>
      </span>
    )
  const back = (
    <span className="side back">
      <span className="back-art" />
    </span>
  )
  const classes = ['card', size, flight ? 'flying' : '', turning ? 'turning' : '', faceUp && isRed(card.suit) ? 'red' : '', faceUp && card.suit === trump ? 'trump' : '', className].filter(Boolean).join(' ')
  const face = turning ? (
    <m.span
      key="turning"
      className="flipper"
      initial={{ rotateY: from ? 0 : 180 }}
      animate={{ rotateY: faceUp ? 0 : 180 }}
      transition={flight ? { ...flipSpring, delay: flight.delay + 0.15 } : flipSpring}
      onAnimationComplete={() => setTurn((t) => (t.face === faceUp ? { face: faceUp, from: null } : t))}
    >
      {front}
      {back}
    </m.span>
  ) : (
    <span key="flat" className="flipper">
      {faceUp ? front : back}
    </span>
  )
  const inner = wrap ? wrap(face) : face

  if (onClick)
    return (
      <m.button
        type="button"
        layoutId={card.id}
        transition={transition}
        className={classes}
        style={style}
        animate={animate}
        whileTap={disabled ? undefined : { scale: 0.94 }}
        onClick={onClick}
        disabled={disabled}
        aria-label={label ?? name}
      >
        {inner}
      </m.button>
    )
  return (
    <m.div layoutId={card.id} transition={transition} className={classes} style={style} animate={animate} aria-label={faceUp ? name : undefined} role={faceUp ? 'img' : undefined}>
      {inner}
    </m.div>
  )
}

/**
 * Where the pips sit on a printed card, as [column, row] in a 3 × 7 grid (columns 0–2, rows 0–6).
 * Pips in the lower half are drawn upside down, as on real cards.
 */
const PIPS: Record<number, [number, number][]> = {
  2: [[1, 0], [1, 6]],
  3: [[1, 0], [1, 3], [1, 6]],
  4: [[0, 0], [2, 0], [0, 6], [2, 6]],
  5: [[0, 0], [2, 0], [1, 3], [0, 6], [2, 6]],
  6: [[0, 0], [2, 0], [0, 3], [2, 3], [0, 6], [2, 6]],
  7: [[0, 0], [2, 0], [1, 1.5], [0, 3], [2, 3], [0, 6], [2, 6]],
  8: [[0, 0], [2, 0], [1, 1.5], [0, 3], [2, 3], [1, 4.5], [0, 6], [2, 6]],
  9: [[0, 0], [2, 0], [0, 2], [2, 2], [1, 3], [0, 4], [2, 4], [0, 6], [2, 6]],
  10: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2], [0, 4], [2, 4], [1, 5], [0, 6], [2, 6]],
}

/** The face of a printed playing card: indices in two corners, pips by count, framed court cards. */
export function ClassicFace({ card, trump }: { card: Card; trump: Suit }) {
  const label = rankLabel(card.rank)
  const pips = PIPS[card.rank]
  const corner = (cls: string) => (
    <span className={`corner ${cls}`}>
      <b>{label}</b>
      <SuitIcon suit={card.suit} />
    </span>
  )
  return (
    <span className={`side front classic ${isRed(card.suit) ? 'red' : ''} ${card.suit === trump ? 'trump' : ''}`}>
      {corner('tl')}
      {corner('br')}
      {pips ? (
        <span className="pips">
          {pips.map(([x, y], i) => (
            <span key={i} className={`cpip ${y > 3 ? 'flip' : ''}`} style={{ left: `${x * 50}%`, top: `${(y / 6) * 100}%` }}>
              <SuitIcon suit={card.suit} size="100%" />
            </span>
          ))}
        </span>
      ) : card.rank === 14 ? (
        <span className="ace">
          <SuitIcon suit={card.suit} size="100%" />
        </span>
      ) : (
        <span className="court">
          <span className="court-suit">
            <SuitIcon suit={card.suit} size="100%" />
          </span>
          <b>{label}</b>
          <span className="court-suit flip">
            <SuitIcon suit={card.suit} size="100%" />
          </span>
        </span>
      )}
    </span>
  )
}
