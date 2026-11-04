/**
 * Geometry of the player's hand fan.
 *
 * Cards sit at an even horizontal step, each turned by the same angle more than its left neighbour
 * and dropped onto one circular arc whose radius matches that angle, so the fan stays symmetric,
 * centred and smooth for any number of cards and always fits the width it is given.
 */
export interface FanLayout {
  /** horizontal distance between neighbouring cards, px */
  step: number
  /** total width of the cards' unrotated boxes, px */
  width: number
  /** extra room on each side for the corners of the outermost turned cards, px */
  pad: number
  /** extra height below the cards for the arc and the turned corners, px */
  below: number
  /** rotation of card i, degrees */
  angle: (i: number) => number
  /** how far card i sits below the middle of the arc, px */
  drop: (i: number) => number
}

const RAD = Math.PI / 180
/** most a card turns past its neighbour, degrees */
const MAX_PER_CARD = 3
/** most the whole fan opens, degrees */
const MAX_SPREAD = 22
/** neighbours never sit further apart than this share of a card's width */
const MAX_STEP = 0.92
/** and never closer than this many px, even if the hand then overflows */
const MIN_STEP = 6

/**
 * @param n cards in the hand
 * @param cw card width, px (the card is 1.4 times as tall)
 * @param room width available for the whole fan, corners included, px
 */
export function fanLayout(n: number, cw: number, room: number): FanLayout {
  const ch = cw * 1.4
  if (n <= 1) return { step: 0, width: cw, pad: 0, below: 0, angle: () => 0, drop: () => 0 }
  const mid = (n - 1) / 2
  // Room for the corners is reserved for the widest the fan may open; it only ever opens less.
  const maxHalf = (Math.min(MAX_SPREAD, MAX_PER_CARD * (n - 1)) / 2) * RAD
  const pad = (ch / 2) * Math.sin(maxHalf)
  const step = Math.max(MIN_STEP, Math.min(cw * MAX_STEP, (room - cw - 2 * pad) / (n - 1)))
  // A natural fan pivots around a point about three card heights below; tighter steps turn less.
  const natural = Math.asin(Math.min(1, step / (ch * 3))) / RAD
  const per = Math.min(natural, MAX_PER_CARD, MAX_SPREAD / (n - 1))
  // The arc's radius makes every card stand square to it.
  const radius = step / Math.sin(per * RAD)
  const half = mid * per * RAD
  const angle = (i: number) => (i - mid) * per
  const drop = (i: number) => radius * (1 - Math.cos((i - mid) * per * RAD))
  // the outermost cards drop the most and their lower outer corners swing down by half a width
  const below = radius * (1 - Math.cos(half)) + (cw / 2) * Math.sin(half)
  return { step, width: cw + step * (n - 1), pad, below, angle, drop }
}
