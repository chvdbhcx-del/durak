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
  kind: 'draw' | 'discard' | 'take'
}

export const cardSpring = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 } as const
const flightSpring = { type: 'spring', stiffness: 105, damping: 22, mass: 1 } as const
const flipSpring = { type: 'spring', stiffness: 200, damping: 26 } as const

/**
 * A card keeps its layoutId while it moves between deck, hands, table and discard, so the
 * component remounts in each new spot. Remembering which side was last shown lets the
 * new instance start from that side and flip over during the flight.
 */
const lastFace = new Map<string, boolean>()

export function CardView({ card, faceUp, trump, size = 'full', className = '', style, animate, onClick, disabled, label, flight }: Props) {
  const transition = flight ? { ...flightSpring, delay: flight.delay } : cardSpring
  const name = `${rankLabel(card.rank)} ${SUIT_NAME[card.suit]}`
  const was = lastFace.get(card.id) ?? faceUp
  useEffect(() => {
    lastFace.set(card.id, faceUp)
  }, [card.id, faceUp])

  const classes = ['card', size, faceUp && isRed(card.suit) ? 'red' : '', faceUp && card.suit === trump ? 'trump' : '', className].filter(Boolean).join(' ')
  const inner = (
    <motion.span className="flipper" initial={{ rotateY: was ? 0 : 180 }} animate={{ rotateY: faceUp ? 0 : 180 }} transition={flipSpring}>
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
