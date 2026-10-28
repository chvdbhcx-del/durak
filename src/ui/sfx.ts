/**
 * Card sounds: real recordings (Kenney's CC0 Casino Audio, see src/assets/sounds/CREDITS.md).
 * They are decoded once and each play picks a random take at a slightly different speed, so
 * a run of cards never sounds like the same clip repeated.
 */
import slide1 from '../assets/sounds/card-slide-1.mp3'
import slide2 from '../assets/sounds/card-slide-2.mp3'
import slide3 from '../assets/sounds/card-slide-3.mp3'
import slide4 from '../assets/sounds/card-slide-4.mp3'
import slide5 from '../assets/sounds/card-slide-5.mp3'
import slide6 from '../assets/sounds/card-slide-6.mp3'
import place1 from '../assets/sounds/card-place-1.mp3'
import place2 from '../assets/sounds/card-place-2.mp3'
import place3 from '../assets/sounds/card-place-3.mp3'
import place4 from '../assets/sounds/card-place-4.mp3'
import shove1 from '../assets/sounds/card-shove-1.mp3'
import shove2 from '../assets/sounds/card-shove-2.mp3'
import shove3 from '../assets/sounds/card-shove-3.mp3'
import shove4 from '../assets/sounds/card-shove-4.mp3'

const FILES = {
  slide: [slide1, slide2, slide3, slide4, slide5, slide6],
  place: [place1, place2, place3, place4],
  shove: [shove1, shove2, shove3, shove4],
}
type Kind = keyof typeof FILES

let ctx: AudioContext | null = null
let master: GainNode | null = null
let enabled = true
const buffers: Record<Kind, AudioBuffer[]> = { slide: [], place: [], shove: [] }
let loading = false

type AudioWindow = typeof window & { webkitAudioContext?: typeof AudioContext }

function audio(): AudioContext | null {
  if (!enabled) return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext
    if (!Ctor) return null
    try {
      ctx = new Ctor()
      master = ctx.createGain()
      master.gain.value = 0.7
      master.connect(ctx.destination)
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  if (!loading) {
    loading = true
    load(ctx)
  }
  return ctx
}

function load(c: AudioContext) {
  for (const kind of Object.keys(FILES) as Kind[])
    for (const url of FILES[kind])
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((data) => c.decodeAudioData(data))
        .then((buf) => buffers[kind].push(buf))
        .catch(() => {})
}

function play(kind: Kind, delay: number, { gain = 1, rate = 1 } = {}) {
  const c = audio()
  const pool = buffers[kind]
  if (!c || !master || pool.length === 0) return
  const src = c.createBufferSource()
  src.buffer = pool[Math.floor(Math.random() * pool.length)]
  src.playbackRate.value = rate * (0.94 + Math.random() * 0.14)
  const amp = c.createGain()
  amp.gain.value = gain
  src.connect(amp).connect(master)
  src.start(c.currentTime + delay)
}

export function setSoundEnabled(on: boolean) {
  enabled = on
}

/** Browsers only start audio after a touch, so the first one wakes it up and loads the clips. */
export function unlockSound() {
  const wake = () => {
    audio()
    window.removeEventListener('pointerdown', wake)
    window.removeEventListener('keydown', wake)
  }
  window.addEventListener('pointerdown', wake)
  window.addEventListener('keydown', wake)
}

/** A card put down on the table. */
export function playCard(delay = 0) {
  play('place', delay, { gain: 0.9 })
}

/** A card flicked out of the deck to a hand. */
export function playDeal(delay = 0) {
  play('slide', delay, { gain: 0.75 })
}

/** The table swept into the discard pile or into a hand: a few shoves, one per couple of cards. */
export function playSweep(delay = 0, cards = 4) {
  const shoves = Math.min(3, Math.max(1, Math.ceil(cards / 2)))
  for (let i = 0; i < shoves; i++) play('shove', delay + i * 0.16, { gain: 0.85 })
}
