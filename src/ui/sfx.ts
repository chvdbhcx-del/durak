/**
 * Card sounds made on the fly with the Web Audio API, so the app ships no audio files.
 * Each sound is a short burst of filtered noise shaped like paper and cardboard sliding.
 */

let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null
let enabled = true

type AudioWindow = typeof window & { webkitAudioContext?: typeof AudioContext }

function audio(): AudioContext | null {
  if (!enabled) return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext
    if (!Ctor) return null
    try {
      ctx = new Ctor()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function noiseBuffer(c: AudioContext) {
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate * 1.2, c.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noise
}

/** One rustle: noise through a band-pass, with an envelope of attack and decay. */
function burst(c: AudioContext, at: number, { dur, freq, q, gain, flutter = 0 }: { dur: number; freq: number; q: number; gain: number; flutter?: number }) {
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c)
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = q
  filter.frequency.setValueAtTime(freq * 0.7, at)
  filter.frequency.exponentialRampToValueAtTime(freq * 1.25, at + dur)
  const amp = c.createGain()
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.012, dur / 4))
  // A few small dips make a sweep sound like several cards instead of one hiss.
  for (let i = 1; i <= flutter; i++) {
    const t = at + (dur * i) / (flutter + 1)
    amp.gain.exponentialRampToValueAtTime(gain * 0.35, t - dur * 0.04)
    amp.gain.exponentialRampToValueAtTime(gain * 0.9, t + dur * 0.03)
  }
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  src.connect(filter).connect(amp).connect(c.destination)
  src.start(at, Math.random() * 0.5)
  src.stop(at + dur + 0.02)
}

export function setSoundEnabled(on: boolean) {
  enabled = on
}

/** Browsers only start audio after a touch, so the first one wakes it up. */
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
  const c = audio()
  if (!c) return
  const t = c.currentTime + delay
  burst(c, t, { dur: 0.11, freq: 2600, q: 0.9, gain: 0.5 })
  burst(c, t + 0.015, { dur: 0.07, freq: 900, q: 1.4, gain: 0.35 })
}

/** A card flicked out of the deck to a hand. */
export function playDeal(delay = 0) {
  const c = audio()
  if (!c) return
  const t = c.currentTime + delay
  burst(c, t, { dur: 0.085, freq: 3600, q: 1.1, gain: 0.34 })
}

/** The table swept into the discard pile or into a hand: a longer shuffle. */
export function playSweep(delay = 0, cards = 4) {
  const c = audio()
  if (!c) return
  const t = c.currentTime + delay
  burst(c, t, { dur: Math.min(0.55, 0.28 + cards * 0.05), freq: 2200, q: 0.7, gain: 0.5, flutter: Math.min(4, cards) })
}
