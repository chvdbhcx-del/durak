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

/** below this step (px) a card in one row is too thin a strip to hit with a thumb */
export const COMFY_STEP = 22
/** a big hand splits into two rows only from this many cards */
const TWO_ROWS_FROM = 13

export interface HandSpot {
  row: 0 | 1
  /** index of the card within its row */
  col: number
  left: number
  top: number
  angle: number
  drop: number
  /** how far the card may be pushed sideways inside its row */
  minLeft: number
  maxLeft: number
}

export interface HandLayout {
  rows: 1 | 2
  /** width of the cards' unrotated boxes, the wider row, px */
  width: number
  pad: number
  below: number
  /** extra height the back row takes above the front row, px */
  lift: number
  spot: (i: number) => HandSpot
  /** the card under a point given relative to the hand box (x from its left, y from the top of the cards) */
  pick: (x: number, y: number) => number
  /** whether cards i and j sit in the same row */
  sameRow: (i: number, j: number) => boolean
}

/**
 * The player's hand: one fan, or for a big hand on a narrow screen two fans, the back row raised
 * so that only its top with the indices shows above the front row. The back row holds the later
 * cards of the sorted hand: the higher ranks and the trumps.
 */
export function handLayout(n: number, cw: number, room: number): HandLayout {
  const one = fanLayout(n, cw, room)
  if (n < TWO_ROWS_FROM || one.step >= COMFY_STEP) {
    const spot = (i: number): HandSpot => ({ row: 0, col: i, left: i * one.step, top: 0, angle: one.angle(i), drop: one.drop(i), minLeft: 0, maxLeft: one.width - cw })
    return {
      rows: 1,
      width: one.width,
      pad: one.pad,
      below: one.below,
      lift: 0,
      spot,
      pick: (x) => (n > 1 ? Math.max(0, Math.min(n - 1, Math.round((x - cw / 2) / one.step))) : 0),
      sameRow: () => true,
    }
  }
  const front = Math.ceil(n / 2)
  const back = n - front
  const fl = fanLayout(front, cw, room)
  const bl = fanLayout(back, cw, room)
  const width = Math.max(fl.width, bl.width)
  const lift = Math.round(cw * 1.4 * 0.42)
  const offF = (width - fl.width) / 2
  const offB = (width - bl.width) / 2
  const spot = (i: number): HandSpot => {
    if (i < front) return { row: 1, col: i, left: offF + i * fl.step, top: lift, angle: fl.angle(i), drop: fl.drop(i), minLeft: offF, maxLeft: offF + fl.width - cw }
    const c = i - front
    return { row: 0, col: c, left: offB + c * bl.step, top: 0, angle: bl.angle(c), drop: bl.drop(c), minLeft: offB, maxLeft: offB + bl.width - cw }
  }
  const pick = (x: number, y: number) => {
    if (y < lift) {
      const c = back > 1 ? Math.max(0, Math.min(back - 1, Math.round((x - offB - cw / 2) / bl.step))) : 0
      return front + c
    }
    return front > 1 ? Math.max(0, Math.min(front - 1, Math.round((x - offF - cw / 2) / fl.step))) : 0
  }
  return { rows: 2, width, pad: Math.max(fl.pad, bl.pad), below: fl.below, lift, spot, pick, sameRow: (i, j) => i < front === j < front }
}
