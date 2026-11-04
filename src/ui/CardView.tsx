import { motion, type MotionStyle, type TargetAndTransition } from 'framer-motion'
import { useEffect, type MouseEventHandler } from 'react'
import { Card, isRed, rankLabel, Suit, SUIT_NAME } from '../engine/cards'
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

export function CardView({ card, faceUp, trump, size = 'full', className = '', style, animate, onClick, disabled, label, flight }: Props) {
  const transition = flight ? { type: 'tween' as const, ...FLIGHT[flight.kind], delay: flight.delay } : cardSpring
  const name = `${rankLabel(card.rank)} ${SUIT_NAME[card.suit]}`
  const was = lastFace.get(card.id) ?? faceUp
  useEffect(() => {
    lastFace.set(card.id, faceUp)
  }, [card.id, faceUp])

  const classes = ['card', size, flight ? 'flying' : '', faceUp && isRed(card.suit) ? 'red' : '', faceUp && card.suit === trump ? 'trump' : '', className].filter(Boolean).join(' ')
  const inner = (
    <motion.span className="flipper" initial={{ rotateY: was ? 0 : 180 }} animate={{ rotateY: faceUp ? 0 : 180 }} transition={flight ? { ...flipSpring, delay: flight.delay + 0.15 } : flipSpring}>
      <span className={`side front ${isRed(card.suit) ? 'red' : ''} ${card.suit === trump ? 'trump' : ''}`}>
        <span className="corner tl">
          <b>{rankLabel(card.rank)}</b>
          <SuitIcon suit={card.suit} />
        </span>
        <span className="pip">
          <SuitIcon suit={card.suit} size="100%" />
        </span>
      </span>
      <span className="side back">
        <span className="back-art" />
      </span>
    </motion.span>
  )

  if (onClick)
    return (
      <motion.button
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
      </motion.button>
    )
  return (
    <motion.div layoutId={card.id} transition={transition} className={classes} style={style} animate={animate} aria-label={faceUp ? name : undefined} role={faceUp ? 'img' : undefined}>
      {inner}
    </motion.div>
  )
}
